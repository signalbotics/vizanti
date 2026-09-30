const finite = (v) => typeof v === "number" && Number.isFinite(v);

// One-sigma ellipse of the x/y part of a 6x6 pose covariance (row-major, 36 values).
// Returns { rx, ry, theta } or null when the covariance is unusable.
export function covarianceEllipse(covariance) {
	if (!covariance || covariance.length < 36)
		return null;
	const a = covariance[0], b = covariance[1], c = covariance[7];
	if (!finite(a) || !finite(b) || !finite(c))
		return null;

	const trace = a + c;
	const det = a * c - b * b;
	const root = Math.sqrt(Math.max(trace * trace / 4 - det, 0));
	const lambda1 = trace / 2 + root;
	const lambda2 = trace / 2 - root;
	if (!(lambda1 > 0) || lambda2 < 0)
		return null;

	// eigenvector of the larger eigenvalue; aligned with the axes when there is no correlation
	const theta = b !== 0 ? Math.atan2(b, lambda1 - c) : (a >= c ? 0 : Math.PI / 2);
	return { rx: Math.sqrt(lambda1), ry: Math.sqrt(lambda2), theta };
}

// A filled ellipse in the XY plane as a triangle fan.
export function ellipseTriangles(rx, ry, theta, steps = 32) {
	const out = [];
	const cos = Math.cos(theta), sin = Math.sin(theta);
	const point = (angle) => {
		const x = rx * Math.cos(angle), y = ry * Math.sin(angle);
		return [x * cos - y * sin, x * sin + y * cos];
	};
	for (let i = 0; i < steps; i++) {
		const p0 = point((2 * Math.PI * i) / steps);
		const p1 = point((2 * Math.PI * (i + 1)) / steps);
		out.push(0, 0, 0, p0[0], p0[1], 0, p1[0], p1[1], 0);
	}
	return new Float32Array(out);
}

// The long arrow of the pose display, lying in the XY plane and pointing along +x.
export function longArrow(scale) {
	const h = 2.0 * scale, w = 0.06 * scale, tip = 0.24 * scale, tw = 0.18 * scale;
	const neck = h - tip;
	return new Float32Array([
		0, -w, 0, neck, -w, 0, neck, w, 0,
		0, -w, 0, neck, w, 0, 0, w, 0,
		neck, -tw, 0, h, 0, 0, neck, tw, 0,
	]);
}

export function eulerFromQuat(q) {
	const { x, y, z, w } = q;
	const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
	const sinp = 2 * (w * y - z * x);
	const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
	const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
	return { roll, pitch, yaw };
}

// Full width in radians of the two-sigma heading uncertainty.
export function yawSpread(covariance) {
	if (!covariance || covariance.length < 36 || !(covariance[35] > 0))
		return 0;
	return Math.min(2 * Math.sqrt(covariance[35]), 2 * Math.PI);
}
