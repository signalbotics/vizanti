// CSV of several series that each have their own timestamps: one row per distinct time (merged
// in order), a column per series, empty where a series has no sample at that time.
// columns: [{ name, times, values }] with times ascending. Pure, so it runs under node --test.

const quote = (text) => (/[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text);

export function toCsv(columns, { t0 = 0 } = {}) {
	const lines = [["time", ...columns.map((c) => quote(c.name))].join(",")];
	const next = columns.map(() => 0);
	for (;;) {
		let t = Infinity;
		for (let c = 0; c < columns.length; c++) {
			if (next[c] < columns[c].times.length && columns[c].times[next[c]] < t)
				t = columns[c].times[next[c]];
		}
		if (t === Infinity)
			break;
		const row = [(t - t0).toFixed(6)];
		for (let c = 0; c < columns.length; c++) {
			const col = columns[c];
			if (next[c] < col.times.length && col.times[next[c]] === t) {
				const v = col.values[next[c]];
				row.push(Number.isFinite(v) ? String(v) : "");
				next[c]++;
			} else {
				row.push("");
			}
		}
		lines.push(row.join(","));
	}
	return lines.join("\n") + "\n";
}
