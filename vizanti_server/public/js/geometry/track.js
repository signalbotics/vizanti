const finite = (v) => typeof v === "number" && Number.isFinite(v);

// Adds a pose to a recorded track. Movement under minDelta metres is ignored so a parked
// robot does not fill the history. Returns true when the pose was added.
export function appendSample(samples, pose, max, minDelta = 0.03) {
	if (!finite(pose.x) || !finite(pose.y) || !finite(pose.z) || !finite(pose.yaw))
		return false;
	if (samples.length > 0) {
		const last = samples[samples.length - 1];
		if (Math.hypot(last.x - pose.x, last.y - pose.y, last.z - pose.z) <= minDelta)
			return false;
	}
	samples.push({ x: pose.x, y: pose.y, z: pose.z, yaw: pose.yaw });
	while (samples.length > max)
		samples.shift();
	return true;
}

// Heading arrows along a track, at least `spacing` metres apart. Returns triangle vertices.
export function arrowMarks(samples, spacing, length, halfWidth) {
	const out = [];
	let previous = null;
	const half = length / 2;
	for (const s of samples) {
		if (previous && Math.hypot(s.x - previous.x, s.y - previous.y, s.z - previous.z) < spacing - 1e-9)
			continue;
		const cos = Math.cos(s.yaw), sin = Math.sin(s.yaw);
		for (const [x, y] of [[-half, -halfWidth], [half, 0], [-half, halfWidth]])
			out.push(s.x + x * cos - y * sin, s.y + x * sin + y * cos, s.z);
		previous = s;
	}
	return new Float32Array(out);
}

export function samplesToCsv(samples) {
	let csv = "x,y,yaw\n";
	for (const s of samples)
		csv += `${s.x},${s.y},${s.yaw}\n`;
	return csv;
}

// The old widget stored its target as "name (Frame)" or "name (Odometry)".
export function parseLegacyTarget(text) {
	const value = typeof text === "string" ? text : "";
	if (value.endsWith(" (Odometry)"))
		return { mode: "topic", frame: "", topic: value.slice(0, -" (Odometry)".length) };
	if (value.endsWith(" (Frame)"))
		return { mode: "tf", frame: value.slice(0, -" (Frame)".length), topic: "" };
	return { mode: "tf", frame: "", topic: "" };
}
