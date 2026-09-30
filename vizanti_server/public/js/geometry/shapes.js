import { rotateVector } from './tf.js';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
const finite = (v) => typeof v === "number" && Number.isFinite(v);
const finitePoint = (p) => p && finite(p.x) && finite(p.y) && finite(p.z);

// An all-zero quaternion is a common publisher mistake; treat it as "no rotation".
export function normalizeQuat(q) {
	if (!q || ![q.x, q.y, q.z, q.w].every(finite))
		return { ...IDENTITY };
	if (q.x === 0 && q.y === 0 && q.z === 0 && q.w === 0)
		return { ...IDENTITY };
	return { x: q.x, y: q.y, z: q.z, w: q.w };
}

// Flat arrows lying in each pose's own XY plane, pointing along its x axis.
//   poses: [{ position, orientation }], in whatever frame the caller draws them in
//   simple: single triangles, for large pose clouds
// Returns triangle vertices (x,y,z per vertex).
export function posesToArrows(poses, scale, simple) {
	const out = [];

	let shape;
	if (simple) {
		const h = 0.3 * scale, w = 0.06 * scale;
		shape = [[0, -w], [h, 0], [0, w]];
	} else {
		const h = 0.5 * scale, w = 0.01 * scale, tip = 0.07 * scale, tw = 0.07 * scale;
		const neck = h - tip;
		shape = [
			[0, -w], [neck, -w], [neck, w],
			[0, -w], [neck, w], [0, w],
			[neck, -tw], [h, 0], [neck, tw],
		];
	}

	for (const pose of poses) {
		if (!pose || !finitePoint(pose.position))
			continue;
		const q = normalizeQuat(pose.orientation);
		const p = pose.position;
		for (const [x, y] of shape) {
			const v = rotateVector(q, [x, y, 0]);
			out.push(p.x + v[0], p.y + v[1], p.z + v[2]);
		}
	}
	return new Float32Array(out);
}

// Line segments joining consecutive points; points that are not finite are left out.
export function pathSegments(points) {
	const good = points.filter(finitePoint);
	const out = [];
	for (let i = 0; i < good.length - 1; i++)
		out.push(good[i].x, good[i].y, good[i].z, good[i + 1].x, good[i + 1].y, good[i + 1].z);
	return new Float32Array(out);
}

export function pathLength(points) {
	const good = points.filter(finitePoint);
	let total = 0;
	for (let i = 0; i < good.length - 1; i++)
		total += Math.hypot(good[i + 1].x - good[i].x, good[i + 1].y - good[i].y, good[i + 1].z - good[i].z);
	return total;
}

export function formatDistance(meters) {
	if (meters > 1000)
		return (meters / 1000).toFixed(3) + " km";
	if (meters < 1)
		return (meters * 100).toFixed(1) + " cm";
	return meters.toFixed(2) + " m";
}

// A flat ring sector in the XY plane, centred on +x, from radius `inner` to `outer`
// across `fov` radians. Returns triangle vertices.
export function rangeSector(inner, outer, fov, steps = 24) {
	if (!finite(inner) || !finite(outer) || !finite(fov) || !(outer > inner) || !(fov > 0) || inner < 0)
		return new Float32Array(0);

	const out = [];
	const span = Math.min(fov, 2 * Math.PI);
	for (let i = 0; i < steps; i++) {
		const a0 = -span / 2 + (span * i) / steps;
		const a1 = -span / 2 + (span * (i + 1)) / steps;
		const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
		out.push(
			inner * c0, inner * s0, 0, outer * c0, outer * s0, 0, outer * c1, outer * s1, 0,
			inner * c0, inner * s0, 0, outer * c1, outer * s1, 0, inner * c1, inner * s1, 0
		);
	}
	return new Float32Array(out);
}

// One quad (two triangles) per grid cell, centred on the cell position.
// More cells than `budget` are thinned by taking every `stride`-th cell.
export function cellQuads(cells, width, height, budget = 50000) {
	const stride = cells.length > budget ? Math.ceil(cells.length / budget) : 1;
	const hw = Math.abs(width) / 2, hh = Math.abs(height) / 2;
	const out = [];
	let count = 0;
	for (let i = 0; i < cells.length; i += stride) {
		const c = cells[i];
		if (!finitePoint(c))
			continue;
		out.push(
			c.x - hw, c.y - hh, c.z, c.x + hw, c.y - hh, c.z, c.x + hw, c.y + hh, c.z,
			c.x - hw, c.y - hh, c.z, c.x + hw, c.y + hh, c.z, c.x - hw, c.y + hh, c.z
		);
		count++;
	}
	return { positions: new Float32Array(out), count, stride };
}
