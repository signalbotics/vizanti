// Per-curve transforms, applied when drawing to the samples in view (PlotJuggler's "custom
// series" for the common cases). A transform is { kind, ...params }; the samples before the
// visible range that a derivative or moving average needs are read from the series itself.

export const TRANSFORMS = {
	none: { label: "None", params: {} },
	derivative: { label: "Derivative (d/dt)", params: {} },
	scale: { label: "Scale and offset", params: { gain: 1, offset: 0 } },
	moving_average: { label: "Moving average", params: { samples: 10 } },
	abs: { label: "Absolute value", params: {} },
};

// a usable transform from whatever was saved (unknown kinds and bad numbers fall back)
export function normalizeTransform(transform) {
	const kind = transform && Object.hasOwn(TRANSFORMS, transform.kind) ? transform.kind : "none";
	const out = { kind };
	for (const [key, fallback] of Object.entries(TRANSFORMS[kind].params)) {
		const value = Number(transform?.[key]);
		out[key] = Number.isFinite(value) ? value : fallback;
	}
	if (kind === "moving_average")
		out.samples = Math.max(1, Math.min(10000, Math.round(out.samples)));
	return out;
}

// a short tag for the legend ("" for none)
export function transformTag(transform) {
	const t = normalizeTransform(transform);
	switch (t.kind) {
		case "derivative": return "d/dt";
		case "scale": return `×${t.gain}${t.offset ? (t.offset > 0 ? ` +${t.offset}` : ` ${t.offset}`) : ""}`;
		case "moving_average": return `avg ${t.samples}`;
		case "abs": return "|x|";
		default: return "";
	}
}

// the transformed values of samples [i0, i1) of a series, as a Float64Array (NaN where a value
// is undefined, such as the derivative of the first sample)
export function applyTransform(series, i0, i1, transform) {
	const t = normalizeTransform(transform);
	const n = Math.max(0, i1 - i0);
	const out = new Float64Array(n);
	switch (t.kind) {
		case "derivative":
			for (let k = 0; k < n; k++) {
				const i = i0 + k;
				if (i === 0) {
					out[k] = NaN;
					continue;
				}
				const dt = series.timeAt(i) - series.timeAt(i - 1);
				out[k] = dt > 0 ? (series.valueAt(i) - series.valueAt(i - 1)) / dt : NaN;
			}
			return out;
		case "scale":
			for (let k = 0; k < n; k++)
				out[k] = series.valueAt(i0 + k) * t.gain + t.offset;
			return out;
		case "abs":
			for (let k = 0; k < n; k++)
				out[k] = Math.abs(series.valueAt(i0 + k));
			return out;
		case "moving_average": {
			// a running sum over the last `samples` samples, started before i0 where it can be
			const first = Math.max(0, i0 - t.samples + 1);
			let sum = 0;
			let count = 0;
			for (let i = first; i < i0 + n; i++) {
				sum += series.valueAt(i);
				count++;
				if (count > t.samples) {
					sum -= series.valueAt(i - t.samples);
					count--;
				}
				if (i >= i0)
					out[i - i0] = sum / count;
			}
			return out;
		}
		default:
			for (let k = 0; k < n; k++)
				out[k] = series.valueAt(i0 + k);
			return out;
	}
}
