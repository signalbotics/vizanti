// The ParticleCloud display (nav2_rviz_plugins/ParticleCloud) without three.js: each particle's
// arrow length from its weight, the flat arrows' line vertices, and the RViz settings. Pure.

export const SHAPES = ["Arrow (Flat)", "Arrow (3D)", "Axes"];

// rviz_rendering::Arrow proportions, relative to the shaft length
export const SHAFT_RADIUS = 0.0435, HEAD_LENGTH = 0.3043, HEAD_RADIUS = 0.1304;

// weight * (max - min) + min, kept within [min, max]
export function particleLength(weight, min, max) {
	return Math.min(Math.max(weight * (max - min) + min, min), max);
}

// q * v for a unit quaternion {x, y, z, w}
function rotate(q, x, y, z) {
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

function unit(q) {
	const n = Math.hypot(q?.x ?? 0, q?.y ?? 0, q?.z ?? 0, q?.w ?? 0);
	return n > 0 ? { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n } : { x: 0, y: 0, z: 0, w: 1 };
}

const finite = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);

// the particles the display draws: [{ position, orientation (unit), length }]; a message with a
// non-finite value is refused whole, as RViz refuses it ("invalid floating point values")
export function particlePoses(msg, min, max) {
	const particles = msg?.particles ?? [];
	for (const p of particles)
		if (!finite(p.pose?.position) || !Number.isFinite(p.weight))
			return null;
	return particles.map((p) => ({ position: p.pose.position, orientation: unit(p.pose.orientation), length: particleLength(p.weight, min, max) }));
}

// FlatWeightedArrowsArray: a line list, three segments per arrow (shaft and two head strokes)
export function flatArrowVertices(poses) {
	const out = new Float32Array(poses.length * 18);
	let i = 0;
	for (const { position: p, orientation: q, length: l } of poses) {
		const tip = rotate(q, l, 0, 0);
		const left = rotate(q, 0.75 * l, 0.2 * l, 0);
		const right = rotate(q, 0.75 * l, -0.2 * l, 0);
		for (const [a, b] of [[[0, 0, 0], tip], [tip, left], [tip, right]]) {
			out[i++] = p.x + a[0]; out[i++] = p.y + a[1]; out[i++] = p.z + a[2];
			out[i++] = p.x + b[0]; out[i++] = p.y + b[1]; out[i++] = p.z + b[2];
		}
	}
	return out;
}

// an RViz "R; G; B" colour -> "#rrggbb"
export function rvizColor(value, fallback) {
	const parts = String(value ?? "").split(";").map((s) => Number(s.trim()));
	if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n)))
		return fallback;
	return "#" + parts.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("");
}

// the RViz display's settings -> this display's properties
export function particleCloudFromRviz(entry) {
	const props = {};
	const topic = entry?.Topic?.Value ?? entry?.Topic;
	if (typeof topic === "string" && topic)
		props.topic = topic;
	if (SHAPES.includes(entry?.Shape))
		props.shape = entry.Shape;
	const color = rvizColor(entry?.Color, null);
	if (color)
		props.color = color;
	for (const [key, rviz] of [["alpha", "Alpha"], ["min_length", "Min Arrow Length"], ["max_length", "Max Arrow Length"]])
		if (entry?.[rviz] !== undefined && entry[rviz] !== "" && Number.isFinite(Number(entry[rviz])))
			props[key] = Number(entry[rviz]);
	return props;
}
