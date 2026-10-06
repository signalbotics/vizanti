export function radToDeg(value) {
	return (value * (180 / Math.PI)).toFixed(2);
}

// Converts a sensor_msgs/LaserScan into x,y,z points in the sensor frame, with each kept ray's
// range and (when the scan has them) intensity.
// Scans with more rays than `budget` are thinned by taking every `stride`-th ray.
export function scanPoints(msg, budget = 20000) {
	const n = msg.ranges.length;
	const stride = n > budget ? Math.ceil(n / budget) : 1;
	const capacity = Math.ceil(n / stride);
	const out = new Float32Array(capacity * 3);
	const hasIntensity = Array.isArray(msg.intensities) || ArrayBuffer.isView(msg.intensities)
		? msg.intensities.length === n && n > 0
		: false;
	const intensities = hasIntensity ? new Float32Array(capacity) : null;
	const ranges = new Float32Array(capacity);
	let count = 0;

	for (let i = 0; i < n; i += stride) {
		const range = msg.ranges[i];
		// rosbridge sends NaN and infinity as null, which would otherwise compare as 0
		if (typeof range !== "number" || !Number.isFinite(range))
			continue;
		if (range < msg.range_min || range > msg.range_max)
			continue;

		const angle = msg.angle_min + i * msg.angle_increment;
		out[count * 3] = range * Math.cos(angle);
		out[count * 3 + 1] = range * Math.sin(angle);
		out[count * 3 + 2] = 0;
		ranges[count] = range;
		if (intensities)
			intensities[count] = msg.intensities[i];
		count++;
	}

	return {
		positions: out.slice(0, count * 3),
		ranges: ranges.slice(0, count),
		intensities: intensities ? intensities.slice(0, count) : null,
		count,
		stride,
	};
}
