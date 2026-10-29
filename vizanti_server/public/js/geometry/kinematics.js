// Forward kinematics on a parsed URDF (geometry/urdf.js parseUrdf): where every link is, relative
// to the root link, for given joint positions. Used to draw robot states that are not on TF
// (MoveIt's start, goal and planned states). Pure.
import { rpyToQuat } from './urdf.js';

// quaternions are { x, y, z, w }, vectors [x, y, z]
export function quatMultiply(a, b) {
	return {
		x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
		y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
		z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
		w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
	};
}

export function quatRotate(q, [x, y, z]) {
	const ix = q.w * x + q.y * z - q.z * y;
	const iy = q.w * y + q.z * x - q.x * z;
	const iz = q.w * z + q.x * y - q.y * x;
	const iw = -q.x * x - q.y * y - q.z * z;
	return [
		ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
		iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
		iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
	];
}

export function axisAngle([x, y, z], angle) {
	const n = Math.hypot(x, y, z) || 1;
	const s = Math.sin(angle / 2) / n;
	return { x: x * s, y: y * s, z: z * s, w: Math.cos(angle / 2) };
}

// a pose { translation: [x, y, z], rotation: quat } composed with another (parent * child)
export function compose(parent, child) {
	const moved = quatRotate(parent.rotation, child.translation);
	return {
		translation: [parent.translation[0] + moved[0], parent.translation[1] + moved[1], parent.translation[2] + moved[2]],
		rotation: quatMultiply(parent.rotation, child.rotation),
	};
}

export const IDENTITY = Object.freeze({ translation: [0, 0, 0], rotation: { x: 0, y: 0, z: 0, w: 1 } });

// the value a joint takes: its own position, or for a mimic joint its leader's, scaled
export function jointValue(robot, name, positions) {
	const joint = robot.joints[name];
	if (joint?.mimic)
		return (positions[joint.mimic.joint] ?? 0) * joint.mimic.multiplier + joint.mimic.offset;
	return positions[name] ?? 0;
}

// The movable joints (not fixed, not mimic), in URDF order: what a joint state names.
export function movableJoints(robot) {
	return Object.entries(robot.joints)
		.filter(([, j]) => !j.mimic && ["revolute", "continuous", "prismatic"].includes(j.type))
		.map(([name]) => name);
}

// positions: { [joint]: value } (missing joints are 0). Returns Map link -> pose relative to the
// root link. Floating and planar joints stay at their origin (their pose is not a single value).
export function forwardKinematics(robot, positions = {}) {
	const byParent = new Map();
	for (const [name, joint] of Object.entries(robot.joints)) {
		if (!byParent.has(joint.parent))
			byParent.set(joint.parent, []);
		byParent.get(joint.parent).push([name, joint]);
	}
	const poses = new Map();
	if (!robot.root)
		return poses;
	poses.set(robot.root, IDENTITY);
	const queue = [robot.root];
	while (queue.length) {
		const link = queue.shift();
		const base = poses.get(link);
		for (const [name, joint] of byParent.get(link) ?? []) {
			if (poses.has(joint.child))
				continue; // a loop in a broken URDF
			let pose = compose(base, { translation: joint.origin.xyz, rotation: rpyToQuat(joint.origin.rpy) });
			const value = jointValue(robot, name, positions);
			if (joint.type === "revolute" || joint.type === "continuous")
				pose = compose(pose, { translation: [0, 0, 0], rotation: axisAngle(joint.axis, value) });
			else if (joint.type === "prismatic")
				pose = compose(pose, { translation: joint.axis.map((a) => a * value), rotation: IDENTITY.rotation });
			poses.set(joint.child, pose);
			queue.push(joint.child);
		}
	}
	return poses;
}
