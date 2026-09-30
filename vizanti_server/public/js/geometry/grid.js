export const MAX_LINES = 300;

// visible metres divided by this gives the target step
export const AUTOSCALE_DIVISORS = { "Rough": 3, "Coarse": 7, "Fine": 14, "Very Fine": 21 };

// Snaps a length to the nearest 1/2/5 * 10^n step
export function calculateScale(value) {
	const magnitude = Math.floor(Math.log10(value));
	value /= Math.pow(10, magnitude);

	if (value < 1.5)
		value = 1.0;
	else if (value < 3.5)
		value = 2.0;
	else if (value < 7.5)
		value = 5.0;
	else
		value = 10.0;

	return value * Math.pow(10, magnitude);
}

// Picks the step and subdivision count that keep the line count per axis under maxLines.
//   visibleMeters: shorter side of the view, used for autoscale
//   radius: how far from the view centre the grid has to reach
export function fitGrid({ step, subdivisions, autoscale, visibleMeters, radius, maxLines = MAX_LINES }) {
	const auto = autoscale in AUTOSCALE_DIVISORS;
	let s = auto ? calculateScale(visibleMeters / AUTOSCALE_DIVISORS[autoscale]) : step;
	let sub = Math.max(1, subdivisions);
	const count = () => (2 * radius) / (s / sub);

	while (count() > maxLines && sub > 1)
		sub--;

	if (count() > maxLines) {
		if (!auto)
			return { step: s, subdivisions: sub, tooDense: true };
		while (count() > maxLines)
			s = calculateScale(s * 2.1);
	}
	return { step: s, subdivisions: sub, tooDense: false };
}

// Line segments for a grid spanning n cells either side of cell (ci, cj), in the grid's own XY plane.
export function gridLines({ step, subdivisions, ci, cj, n }) {
	const xmin = (ci - n) * step, xmax = (ci + n) * step;
	const ymin = (cj - n) * step, ymax = (cj + n) * step;
	const main = [];
	const sub = [];

	for (let i = ci - n; i <= ci + n; i++)
		main.push(i * step, ymin, 0, i * step, ymax, 0);
	for (let j = cj - n; j <= cj + n; j++)
		main.push(xmin, j * step, 0, xmax, j * step, 0);

	if (subdivisions > 1) {
		const d = step / subdivisions;
		for (let i = ci - n; i < ci + n; i++) {
			for (let k = 1; k < subdivisions; k++) {
				const x = i * step + k * d;
				sub.push(x, ymin, 0, x, ymax, 0);
			}
		}
		for (let j = cj - n; j < cj + n; j++) {
			for (let k = 1; k < subdivisions; k++) {
				const y = j * step + k * d;
				sub.push(xmin, y, 0, xmax, y, 0);
			}
		}
	}

	return { main: new Float32Array(main), sub: new Float32Array(sub) };
}

export function scaleLabel(step) {
	const tidy = (v) => String(+v.toFixed(6));
	if (step >= 1000)
		return tidy(step / 1000) + " km";
	if (step < 1)
		return tidy(step * 100) + " cm";
	return tidy(step) + " m";
}
