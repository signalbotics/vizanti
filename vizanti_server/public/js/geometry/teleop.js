// The teleop joystick's drive model: stick or keys set targets for the two axes, the speeds
// ramp towards them at the set acceleration (20 Hz steps), and each axis feeds one Twist field.

export const AXES = ["linear_x", "linear_y", "linear_z", "angular_x", "angular_y", "angular_z", "none"];
export const AXIS_LABELS = {
	linear_x: "Forward/back (linear.x)",
	linear_y: "Left/right (linear.y)",
	linear_z: "Up/down (linear.z)",
	angular_x: "Roll (angular.x)",
	angular_y: "Pitch (angular.y)",
	angular_z: "Yaw (angular.z)",
	none: "--- (off)",
};

// an acceleration of this much or more means "instant"
export const INSTANT_ACCEL = 12;
export const RATE_HZ = 20;

export const DEFAULT_KEYS = { key_up: "w", key_left: "a", key_down: "s", key_right: "d" };

// The legacy widget's presets: values for the axis setup, as property changes.
export const PRESETS = {
	diffdrive: { label: "Diff drive (linear.x, angular.z)", props: { axis_vert: "linear_x", axis_horiz: "angular_z", vel_vert: 1, vel_horiz: 2, accel_vert: 2, accel_horiz: 4, ackermann_emulation: true } },
	ackermann: { label: "Ackermann (linear.x, angular.z)", props: { axis_vert: "linear_x", axis_horiz: "angular_z", vel_vert: 1, vel_horiz: 0.9, accel_vert: 2, accel_horiz: 6 } },
	holonomic: { label: "Holonomic (linear.x, linear.y)", props: { axis_vert: "linear_x", axis_horiz: "linear_y", vel_vert: 1, vel_horiz: 1, accel_vert: 2, accel_horiz: 2, keybindings: { key_up: "i", key_left: "j", key_down: "k", key_right: "l" } } },
	altitude: { label: "Altitude / depth (linear.z)", props: { axis_vert: "linear_z", axis_horiz: "none", vel_vert: 2, vel_horiz: 0.05, accel_vert: 2, accel_horiz: 0.5, keybindings: { key_up: " ", key_left: "a", key_down: "shift", key_right: "d" } } },
	pitchroll: { label: "Pitch / roll (angular.y, angular.x)", props: { axis_vert: "angular_y", axis_horiz: "angular_x", vel_vert: 2, vel_horiz: 2, accel_vert: 4, accel_horiz: 4, instant_stop: true } },
	pantilt: { label: "Pan / tilt (angular.y, angular.z)", props: { axis_vert: "angular_y", axis_horiz: "angular_z", vel_vert: 0.5, vel_horiz: 0.5, accel_vert: 12, accel_horiz: 12, instant_stop: true } },
};

// a preset's full property set: everything it does not name goes back to its default
export function presetProps(name) {
	const preset = PRESETS[name];
	if (!preset)
		return null;
	return {
		invert_vert: false, invert_horiz: false, ackermann_emulation: false, instant_stop: false,
		keybindings: { ...DEFAULT_KEYS },
		...preset.props,
	};
}

// how a key shows on its button
export function keyLabel(key) {
	const names = { " ": "SPACE", arrowleft: "←", arrowright: "→", arrowup: "↑", arrowdown: "↓" };
	return names[key] ?? String(key).toUpperCase();
}

// One step of the ramp from `speed` towards `target` at `accel` per second.
export function ramp(speed, target, accel, dt = 1 / RATE_HZ) {
	if (accel >= INSTANT_ACCEL)
		return target;
	const step = accel * dt;
	if (speed < target)
		return Math.min(target, speed + step);
	if (speed > target)
		return Math.max(target, speed - step);
	return speed;
}

// The Twist for the two axis speeds under the axis setup.
export function twistFor(vert, horiz, cfg) {
	const twist = { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
	const put = (axis, value) => {
		if (!axis || axis === "none")
			return;
		const [part, field] = axis.split("_");
		twist[part][field] += Math.abs(value) < 1e-9 ? 0 : value; // cos(90°) is 6e-17, not 0
	};
	put(cfg.axis_vert, cfg.invert_vert ? -vert : vert);
	put(cfg.axis_horiz, cfg.invert_horiz ? -horiz : horiz);
	return twist;
}

export class TeleopDrive {

	constructor() {
		this.stop();
	}

	// targets from a stick: angle (radians, 0 = right, counter-clockwise) and force (0..1);
	// or from keys: vert / horiz in -1..1 (leave angle null)
	setTargets(cfg, { angle = null, force = 1, vert = 0, horiz = 0 } = {}) {
		if (angle !== null) {
			const f = Math.min(Math.max(force, 0), 1);
			vert = Math.sin(angle) * f;
			horiz = Math.cos(angle) * f;
		}
		// stick right means turn right: negative yaw
		this.vertTarget = cfg.vel_vert * vert;
		this.horizTarget = -cfg.vel_horiz * horiz;
		// like a car: reversing swaps the steering
		if (cfg.ackermann_emulation && this.vertTarget < 0)
			this.horizTarget = -this.horizTarget;
	}

	// released: coast down at the set acceleration, or stop now with instant_stop
	release(cfg) {
		this.vertTarget = 0;
		this.horizTarget = 0;
		if (cfg.instant_stop)
			this.stop();
	}

	stop() {
		this.vert = this.horiz = this.vertTarget = this.horizTarget = 0;
	}

	get moving() {
		return this.vert !== 0 || this.horiz !== 0 || this.vertTarget !== 0 || this.horizTarget !== 0;
	}

	// advance one step; the Twist to send, or null once everything is at rest
	step(cfg, dt = 1 / RATE_HZ) {
		this.vert = ramp(this.vert, this.vertTarget, cfg.accel_vert, dt);
		this.horiz = ramp(this.horiz, this.horizTarget, cfg.accel_horiz, dt);
		if (Math.abs(this.vert) < 0.005 && Math.abs(this.horiz) < 0.005 && this.vertTarget === 0 && this.horizTarget === 0) {
			this.stop();
			return null;
		}
		return twistFor(this.vert, this.horiz, cfg);
	}
}
