// The attitude indicator (navball): a textured sphere drawn pixel by pixel into a square image.
// Uses the global Quaternion (js/lib/quaternion.min.js).

// For every pixel of a size×size image that shows the sphere: its point on the unit sphere
// facing the viewer, and its offset in the RGBA buffer.
export function navballLut(size) {
	const radius = size / 2;
	const radiusSq = radius * radius;
	const inside = radiusSq * 0.76; // the bezel overlay covers the rest
	let count = 0;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = x - radius, dy = y - radius;
			if (dx * dx + dy * dy <= inside)
				count++;
		}
	}
	const lut = {
		size, count,
		px: new Float32Array(count), py: new Float32Array(count), pz: new Float32Array(count),
		index: new Uint32Array(count),
	};
	let i = 0;
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = x - radius, dy = y - radius;
			const distSq = dx * dx + dy * dy;
			if (distSq > inside)
				continue;
			lut.px[i] = dx / radius;
			lut.py[i] = dy / radius;
			lut.pz[i] = Math.sqrt(radiusSq - distSq) / radius;
			lut.index[i] = (y * size + x) * 4;
			i++;
		}
	}
	return lut;
}

// The ball's rotation for a vehicle attitude (radians: roll, pitch, yaw as the Quaternion
// library's toEuler gives g, pitch, h) in one of the three modes:
//   horizon_fake  "Pilot": from inside, the horizon moves against the vehicle's motion
//   horizon_true  "Inertial reference": the ball is fixed to the world (inverted texture)
//   external      "Observer": the ball turns the way the vehicle does
// altRoll keeps the ball level and turns the centre marker by the roll instead.
export function navballAngles({ roll, pitch, yaw }, mode, altRoll) {
	let trueRoll = roll;
	let inverted = false;
	if (mode === "horizon_true") {
		pitch = -pitch;
		yaw = -yaw + Math.PI / 2;
		roll = roll + Math.PI;
		trueRoll = -roll + Math.PI;
		inverted = true;
	} else if (mode === "horizon_fake") {
		yaw = yaw - Math.PI / 2;
		roll = roll + Math.PI;
		trueRoll = altRoll ? roll + Math.PI : -roll + Math.PI;
	} else {
		yaw = yaw - Math.PI / 2;
		roll = -roll + Math.PI;
	}
	if (altRoll)
		roll = Math.PI;
	return { pitch, yaw, roll, trueRoll, inverted };
}

// Fills the sphere's pixels of `data` (RGBA, size×size) from an equirectangular texture.
export function renderNavball(lut, data, texture, { pitch, yaw, roll }) {
	const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
	const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
	const cosR = Math.cos(roll), sinR = Math.sin(roll);

	const m11 = cosY * cosR + sinY * sinP * sinR;
	const m12 = cosP * sinR;
	const m13 = -sinY * cosR + cosY * sinP * sinR;
	const m21 = -cosY * sinR + sinY * sinP * cosR;
	const m22 = cosP * cosR;
	const m23 = sinY * sinR + cosY * sinP * cosR;
	const m31 = sinY * cosP;
	const m32 = -sinP;
	const m33 = cosY * cosP;

	const texWidth = texture.width;
	const texPixels = texture.data;
	const maxX = texWidth - 1, maxY = texture.height - 1;
	const invPI = 1 / Math.PI;
	const { px, py, pz, index, count } = lut;
	for (let i = 0; i < count; i++) {
		const x = px[i], y = py[i], z = pz[i];
		const rx = x * m11 + y * m21 + z * m31;
		const ry = x * m12 + y * m22 + z * m32;
		const rz = x * m13 + y * m23 + z * m33;
		const u = (-Math.atan2(rx, rz) * invPI + 1) * 0.5;
		const v = 0.5 - Math.asin(Math.max(-1, Math.min(1, ry))) * invPI;
		const t = (((v * maxY) | 0) * texWidth + ((u * maxX) | 0)) * 4;
		const p = index[i];
		data[p] = texPixels[t];
		data[p + 1] = texPixels[t + 1];
		data[p + 2] = texPixels[t + 2];
		data[p + 3] = 255;
	}
}

// compass heading (0 = north, clockwise) of an ENU yaw (0 = east, counter-clockwise), degrees
export function headingFromYaw(yaw) {
	const heading = (90 - yaw * 180 / Math.PI) % 360;
	return (heading + 360) % 360;
}

// A usable unit quaternion, as a plain sanity check on what an IMU sent
export function quaternionValid(q) {
	const norm = Math.hypot(q.x, q.y, q.z, q.w);
	return norm > 0.5 && Math.abs(norm - 1) < 0.1;
}

// Orientation for an IMU that sends no valid quaternion: integrates the gyro and pulls roll and
// pitch towards gravity from the accelerometer (a simple complementary filter).
export class ImuFusion {

	constructor() {
		this.estimate = new Quaternion();
		this.stamp = null;
		this.gyroSeen = false;
	}

	// returns { quat, note }: the estimate and which sensors it came from
	update(msg, current) {
		const { x: gx, y: gy, z: gz } = msg.angular_velocity;
		const { x: ax, y: ay, z: az } = msg.linear_acceleration;
		const now = msg.header.stamp.sec + msg.header.stamp.nanosec * 1e-9;
		const dt = Math.min(this.stamp === null ? 0.05 : Math.max(0, now - this.stamp), 0.05);
		this.stamp = now;

		let gyroQuat = this.estimate;
		if (gx !== 0 || gy !== 0 || gz !== 0) {
			const rate = Math.hypot(gx, gy, gz);
			const angle = rate * dt;
			if (angle > 0.0001)
				gyroQuat = this.estimate.mul(Quaternion.fromAxisAngle([gx / rate, gy / rate, gz / rate], angle)).normalize();
			this.gyroSeen = true;
		}

		if (ax !== 0 || ay !== 0 || az !== 0) {
			const accRoll = Math.atan2(ay, az);
			const accPitch = Math.atan2(-ax, Math.hypot(ay, az));
			const accelQuat = Quaternion.fromEuler(0, 0, accPitch).mul(Quaternion.fromEuler(0, accRoll, 0)).normalize();
			if (this.gyroSeen) {
				const yawQuat = Quaternion.fromEuler(gyroQuat.toEuler().h, 0, 0);
				this.estimate = gyroQuat.slerp(yawQuat.mul(accelQuat).normalize())(0.03);
				return { quat: this.estimate, note: "Quaternion invalid, estimating with accel and gyro." };
			}
			this.estimate = accelQuat;
			return { quat: current.slerp(accelQuat)(0.05), note: "Quaternion and gyro invalid, estimating with accel only." };
		}
		this.estimate = gyroQuat;
		return { quat: gyroQuat, note: "Quaternion and accelerometer invalid, estimating with gyro only." };
	}
}
