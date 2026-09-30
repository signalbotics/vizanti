export const VECTOR_TYPES = [
	"geometry_msgs/msg/WrenchStamped",
	"geometry_msgs/msg/TwistStamped",
	"geometry_msgs/msg/AccelStamped",
];

const finite = (v) => v && [v.x, v.y, v.z].every((n) => typeof n === "number" && Number.isFinite(n));

// The linear and angular vectors of a stamped wrench, twist or acceleration, or null.
export function vectorPair(msg, type) {
	let linear, angular;
	if (type === VECTOR_TYPES[0]) {
		linear = msg.wrench?.force;
		angular = msg.wrench?.torque;
	} else if (type === VECTOR_TYPES[1]) {
		linear = msg.twist?.linear;
		angular = msg.twist?.angular;
	} else {
		linear = msg.accel?.linear;
		angular = msg.accel?.angular;
	}
	return finite(linear) && finite(angular) ? { linear, angular } : null;
}
