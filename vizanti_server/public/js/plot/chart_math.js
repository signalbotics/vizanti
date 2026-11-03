// Axis ticks, number formatting and decimation for the plot canvas. Pure, so it runs under node --test.

// round tick positions (1, 2, 5 × 10^n apart) covering [min, max], at most about `target` of them
export function niceTicks(min, max, target = 6) {
	if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min)
		return { step: 0, ticks: [] };
	const raw = (max - min) / Math.max(1, target);
	const power = 10 ** Math.floor(Math.log10(raw));
	const fraction = raw / power;
	const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power;
	const ticks = [];
	const first = Math.ceil(min / step - 1e-9);
	for (let k = first; k * step <= max + step * 1e-9; k++)
		ticks.push(Math.abs(k * step) < step * 1e-9 ? 0 : k * step);
	return { step, ticks };
}

// a tick label with as many decimals as the step needs (no float noise like 0.30000000000000004)
export function formatTick(value, step) {
	if (value === 0)
		return "0";
	const abs = Math.abs(value);
	if (abs >= 1e6 || abs < 1e-4)
		return value.toExponential(Math.max(0, Math.min(6, -Math.floor(Math.log10(step)) + Math.floor(Math.log10(abs)))));
	const decimals = step > 0 ? Math.max(0, Math.min(9, -Math.floor(Math.log10(step) + 1e-9))) : 3;
	return value.toFixed(decimals);
}

// a value for the legend or a tooltip: about 6 significant digits
export function formatValue(value) {
	if (!Number.isFinite(value))
		return "–";
	const abs = Math.abs(value);
	if (abs !== 0 && (abs >= 1e7 || abs < 1e-4))
		return value.toExponential(4);
	return String(Number(value.toPrecision(6)));
}

// The points to draw for samples (times[i], values[i]) seen through [x0, x1] on `pixels` columns.
// Up to two points per column are kept as they are; beyond that each column keeps its first,
// lowest, highest and last sample in time order, so spikes survive and the line still joins up.
// A NaN value breaks the line: it is kept (as one NaN point) so the renderer can lift the pen.
// Returns { xs, ys, count } in data units (the caller maps them to pixels).
export function decimate(times, values, x0, x1, pixels) {
	const n = Math.min(times.length, values.length);
	const columns = Math.max(1, Math.floor(pixels));
	if (n <= columns * 2 || !(x1 > x0)) {
		const xs = new Float64Array(n);
		const ys = new Float64Array(n);
		xs.set(times.subarray ? times.subarray(0, n) : times.slice(0, n));
		ys.set(values.subarray ? values.subarray(0, n) : values.slice(0, n));
		return { xs, ys, count: n };
	}
	const xs = new Float64Array(columns * 4 + 8);
	const ys = new Float64Array(columns * 4 + 8);
	let count = 0;
	const emit = (i) => {
		if (count > 0 && xs[count - 1] === times[i] && (ys[count - 1] === values[i] || (Number.isNaN(ys[count - 1]) && Number.isNaN(values[i]))))
			return; // the same sample as first and min, say
		if (count === xs.length)
			return;
		xs[count] = times[i];
		ys[count] = values[i];
		count++;
	};
	const scale = columns / (x1 - x0);
	let i = 0;
	while (i < n) {
		const column = Math.floor((times[i] - x0) * scale);
		let first = i, last = i, lo = -1, hi = -1, gap = -1;
		while (i < n && Math.floor((times[i] - x0) * scale) === column) {
			const v = values[i];
			if (Number.isNaN(v)) {
				if (gap === -1)
					gap = i;
			} else {
				if (lo === -1 || v < values[lo]) lo = i;
				if (hi === -1 || v > values[hi]) hi = i;
			}
			last = i;
			i++;
		}
		const picks = [first, lo, hi, gap, last].filter((k) => k !== -1).sort((a, b) => a - b);
		let previous = -1;
		for (const k of picks) {
			if (k !== previous)
				emit(k);
			previous = k;
		}
	}
	return { xs, ys, count };
}

// the range [lo, hi] of the finite values, padded by `pad` of their span (and widened around a
// constant value); null when there are none
export function paddedRange(lo, hi, pad = 0.05) {
	if (!Number.isFinite(lo) || !Number.isFinite(hi))
		return null;
	if (hi - lo < 1e-12 * Math.max(1, Math.abs(lo), Math.abs(hi))) {
		const half = Math.abs(lo) > 1e-9 ? Math.abs(lo) * 0.1 : 1;
		return [lo - half, hi + half];
	}
	const margin = (hi - lo) * pad;
	return [lo - margin, hi + margin];
}
