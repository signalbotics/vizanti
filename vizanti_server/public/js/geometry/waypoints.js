// Pure helpers for the Waypoints display: editing, publishing and drawing a waypoint mission.
// Points are { x, y, z } in the mission's frame; editing is 2D (x, y) with z carried along.

const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function distanceToSegment(p, a, b) {
	const dx = b.x - a.x, dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
	return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// Where a new point goes: into the closest leg it is within `tolerance` of, else at the end.
export function insertIndex(points, p, tolerance) {
	let best = -1, bestDistance = tolerance;
	for (let i = 0; i + 1 < points.length; i++) {
		const d = distanceToSegment(p, points[i], points[i + 1]);
		if (d <= bestDistance) {
			best = i + 1;
			bestDistance = d;
		}
	}
	return best === -1 ? points.length : best;
}

// Index of the point closest to p within `tolerance`, or -1.
export function nearestPoint(points, p, tolerance) {
	let best = -1, bestDistance = tolerance;
	points.forEach((q, i) => {
		const d = dist2(p, q);
		if (d <= bestDistance) {
			best = i;
			bestDistance = d;
		}
	});
	return best;
}

// The waypoint closest to the robot (for "start from closest waypoint").
export function closestIndex(points, robot) {
	let best = 0, bestDistance = Infinity;
	points.forEach((q, i) => {
		const d = dist2(robot, q);
		if (d < bestDistance) {
			best = i;
			bestDistance = d;
		}
	});
	return best;
}

const yawQuat = (yaw) => ({ x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) });

// geometry_msgs/Pose per waypoint, each facing the next one (the last one keeps the final leg's
// heading); a lone waypoint gets the identity orientation.
export function waypointPoses(points) {
	return points.map((p, i) => {
		let orientation = { x: 0, y: 0, z: 0, w: 1 };
		if (points.length > 1) {
			const [a, b] = i + 1 < points.length ? [p, points[i + 1]] : [points[i - 1], p];
			orientation = yawQuat(Math.atan2(b.y - a.y, b.x - a.x));
		}
		return { position: { x: p.x, y: p.y, z: p.z ?? 0 }, orientation };
	});
}

// x,y[,z] per line (comma, semicolon or tab separated); lines that are not numbers are skipped.
export function parseWaypointCsv(text) {
	const out = [];
	for (const line of String(text).split(/\r?\n/)) {
		const cells = line.split(/[,;\t]/).map((c) => c.trim()).filter((c) => c !== "");
		if (cells.length < 2)
			continue;
		const [x, y, z] = cells.map(Number);
		if (!Number.isFinite(x) || !Number.isFinite(y))
			continue;
		out.push({ x, y, z: Number.isFinite(z) ? z : 0 });
	}
	return out;
}

// The safety margin drawn along the path: per leg, a line on each side at `margin` metres.
export function marginSegments(points, margin) {
	const out = [];
	if (!(margin > 0))
		return out;
	for (let i = 0; i + 1 < points.length; i++) {
		const a = points[i], b = points[i + 1];
		const len = dist2(a, b);
		if (len === 0)
			continue;
		const nx = -(b.y - a.y) / len * margin, ny = (b.x - a.x) / len * margin;
		for (const side of [1, -1]) {
			out.push([
				{ x: a.x + side * nx, y: a.y + side * ny, z: a.z ?? 0 },
				{ x: b.x + side * nx, y: b.y + side * ny, z: b.z ?? 0 },
			]);
		}
	}
	return out;
}

// The old 2D widget's saved settings -> this display's properties.
export function fromLegacyWaypoints(state = {}) {
	const points = Array.isArray(state.points) ? state.points : [];
	const props = {
		mission_topic: state.topic,
		message_type: state.topic_type,
		frame: state.fixed_frame,
		robot_frame: state.base_link_frame,
		points: points
			.filter((p) => p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y)))
			.map((p) => ({ x: Number(p.x), y: Number(p.y), z: Number.isFinite(Number(p.z)) ? Number(p.z) : 0 })),
		start_closest: state.start_closest,
		margin: state.margin !== undefined ? Number(state.margin) : undefined,
	};
	return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined));
}
