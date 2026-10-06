export const AXIS_COLORS = {
	x: [0xE0 / 255, 0x00 / 255, 0x0B / 255],
	y: [0x29 / 255, 0xFF / 255, 0x26 / 255],
	z: [0x00 / 255, 0x84 / 255, 0xFF / 255],
};

export const STANDARD_FRAMES = ["world", "earth", "map", "odom", "base_link", "base_footprint", "base_stabilized"];

export function isStandardFrame(name) {
	return STANDARD_FRAMES.some((frame) => name.includes(frame));
}

// q: { w, x, y, z }, v: [x, y, z]
export function rotateVector(q, v) {
	const tx = 2 * (q.y * v[2] - q.z * v[1]);
	const ty = 2 * (q.z * v[0] - q.x * v[2]);
	const tz = 2 * (q.x * v[1] - q.y * v[0]);
	return [
		v[0] + q.w * tx + (q.y * tz - q.z * ty),
		v[1] + q.w * ty + (q.z * tx - q.x * tz),
		v[2] + q.w * tz + (q.x * ty - q.y * tx),
	];
}

// Which frames to draw. Frames seen for the first time are added to `visibility` as shown.
export function visibleFrames(transforms, absolute, visibility) {
	const frames = new Set();
	let changed = false;
	for (const child of Object.keys(transforms)) {
		for (const frame of [child, transforms[child].parent]) {
			if (!(frame in visibility)) {
				visibility[frame] = true;
				changed = true;
			}
			if (visibility[frame] && absolute[frame])
				frames.add(frame);
		}
	}
	return { frames, changed };
}

const UNIT_AXES = [["x", [1, 0, 0]], ["y", [0, 1, 0]], ["z", [0, 0, 1]]];

// transforms: child -> { parent, ... }; absolute: frame -> pose in the fixed frame.
export function tfGeometry(transforms, absolute, frames, axisLength) {
	const axes = [];
	const colors = [];
	const links = [];
	const labels = [];

	for (const name of frames) {
		const pose = absolute[name];
		if (!pose || !pose.translation || !pose.rotation)
			continue;
		const p = pose.translation;

		for (const [axis, unit] of UNIT_AXES) {
			const d = rotateVector(pose.rotation, unit);
			axes.push(p.x, p.y, p.z, p.x + d[0] * axisLength, p.y + d[1] * axisLength, p.z + d[2] * axisLength);
			colors.push(...AXIS_COLORS[axis], ...AXIS_COLORS[axis]);
		}

		labels.push({ name, x: p.x, y: p.y, z: p.z });

		const relative = transforms[name];
		if (relative) {
			const parent = absolute[relative.parent];
			if (parent && parent.translation)
				links.push(p.x, p.y, p.z, parent.translation.x, parent.translation.y, parent.translation.z);
		}
	}

	return {
		axes: new Float32Array(axes),
		colors: new Float32Array(colors),
		links: new Float32Array(links),
		labels,
	};
}

// The top of the TF tree `frame` belongs to (the frame itself when it has no parent).
// transforms: { child: { parent } }. A loop in bad TF data ends the walk.
export function treeRoot(transforms, frame) {
	const seen = new Set();
	let current = frame;
	while (transforms[current]?.parent && !seen.has(current)) {
		seen.add(current);
		current = transforms[current].parent;
	}
	return current;
}

// Whether `frame` can be expressed in `fixed`: both are in the same TF tree.
export function connectedTo(transforms, frame, fixed) {
	if (frame === fixed)
		return true;
	const known = (f) => f in transforms || Object.values(transforms).some((t) => t.parent === f);
	if (!known(frame) || !known(fixed))
		return false;
	return treeRoot(transforms, frame) === treeRoot(transforms, fixed);
}
