// Numbers shown for a sensor_msgs/Imu: orientation as roll, pitch, yaw (degrees, ZYX), and the
// sizes of the linear acceleration and angular velocity vectors.
export function imuSummary(msg) {
	const q = msg.orientation ?? {};
	const norm = Math.hypot(q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 0);
	// covariance[0] = -1 is the ROS convention for "this IMU gives no orientation"
	const hasOrientation = norm > 1e-9 && (msg.orientation_covariance?.[0] ?? 0) !== -1;

	let rpyDeg = null;
	if (hasOrientation) {
		const x = q.x / norm, y = q.y / norm, z = q.z / norm, w = q.w / norm;
		const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
		const pitch = Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x))));
		const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
		rpyDeg = [roll, pitch, yaw].map((v) => v * 180 / Math.PI);
	}
	const a = msg.linear_acceleration ?? {}, g = msg.angular_velocity ?? {};
	return {
		hasOrientation,
		rpyDeg,
		accelNorm: Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0),
		gyroNorm: Math.hypot(g.x ?? 0, g.y ?? 0, g.z ?? 0),
	};
}
