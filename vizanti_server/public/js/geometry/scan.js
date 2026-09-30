export function radToDeg(value) {
	return (value * (180 / Math.PI)).toFixed(2);
}

// Converts a sensor_msgs/LaserScan into x,y,z points in the sensor frame.
// Scans with more rays than `budget` are thinned by taking every `stride`-th ray.
export function scanPoints(msg, budget = 20000) {
	const n = msg.ranges.length;
	const stride = n > budget ? Math.ceil(n / budget) : 1;
	const out = new Float32Array(Math.ceil(n / stride) * 3);
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
		count++;
	}

	return { positions: out.slice(0, count * 3), count, stride };
}
