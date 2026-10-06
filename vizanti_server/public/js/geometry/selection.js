// What a box selection found, per display: how many points (of clouds, scans) and objects
// (meshes, markers) fell in the box, with their centre and extent in the fixed frame.

const MAX_SAMPLES = 50; // points kept to list in the Selection panel

// a drag from (x0, y0) to (x1, y1) as a rectangle, whichever way it was dragged
export function normalizeRect(x0, y0, x1, y1) {
	return { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) };
}

export class SelectionEntry {

	constructor(displayId, name, label) {
		this.displayId = displayId;
		this.name = name;
		this.label = label; // the display type's label
		this.points = 0;
		this.objects = 0;
		this.sum = [0, 0, 0];
		this.min = [Infinity, Infinity, Infinity];
		this.max = [-Infinity, -Infinity, -Infinity];
		this.parts = new Set(); // names of the selected objects (URDF links, marker ids)
		this.samples = []; // { index, x, y, z } of the first points
	}

	_extend(x, y, z) {
		const p = [x, y, z];
		for (let i = 0; i < 3; i++) {
			this.sum[i] += p[i];
			if (p[i] < this.min[i])
				this.min[i] = p[i];
			if (p[i] > this.max[i])
				this.max[i] = p[i];
		}
	}

	addPoint(x, y, z, index) {
		this.points++;
		this._extend(x, y, z);
		if (this.samples.length < MAX_SAMPLES)
			this.samples.push({ index, x, y, z });
	}

	addObject(x, y, z, part = "") {
		this.objects++;
		this._extend(x, y, z);
		if (part)
			this.parts.add(part);
	}

	get count() {
		return this.points + this.objects;
	}

	get centroid() {
		const n = this.count;
		return n ? { x: this.sum[0] / n, y: this.sum[1] / n, z: this.sum[2] / n } : null;
	}

	get size() {
		return this.count ? { x: this.max[0] - this.min[0], y: this.max[1] - this.min[1], z: this.max[2] - this.min[2] } : null;
	}

	clone() {
		const copy = new SelectionEntry(this.displayId, this.name, this.label);
		copy.points = this.points;
		copy.objects = this.objects;
		copy.sum = [...this.sum];
		copy.min = [...this.min];
		copy.max = [...this.max];
		copy.parts = new Set(this.parts);
		copy.samples = [...this.samples];
		return copy;
	}

	// adds another entry of the same display (shift + drag)
	merge(other) {
		this.points += other.points;
		this.objects += other.objects;
		for (let i = 0; i < 3; i++) {
			this.sum[i] += other.sum[i];
			this.min[i] = Math.min(this.min[i], other.min[i]);
			this.max[i] = Math.max(this.max[i], other.max[i]);
		}
		for (const part of other.parts)
			this.parts.add(part);
		this.samples.push(...other.samples.slice(0, MAX_SAMPLES - this.samples.length));
	}
}

// entries by display id; with `add`, the new ones are merged into the old (shift + drag)
export function combineSelections(previous, found, add) {
	if (!add || !previous)
		return found;
	const out = new Map(previous);
	for (const [id, entry] of found) {
		const old = out.get(id);
		if (old) {
			const merged = old.clone();
			merged.merge(entry);
			out.set(id, merged);
		} else {
			out.set(id, entry);
		}
	}
	return out;
}

const f = (v) => (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3); // no "-0.000"

// short lines describing an entry, for the view's labels and the panel
export function entryLines(entry) {
	const lines = [`${entry.name} (${entry.label})`];
	const what = [];
	if (entry.points)
		what.push(`${entry.points} point${entry.points === 1 ? "" : "s"}`);
	if (entry.objects)
		what.push(`${entry.objects} object${entry.objects === 1 ? "" : "s"}`);
	lines.push(what.join(", "));
	const c = entry.centroid;
	if (c)
		lines.push(`Centre: ${f(c.x)}, ${f(c.y)}, ${f(c.z)}`);
	const s = entry.size;
	if (s && entry.count > 1)
		lines.push(`Extent: ${f(s.x)} × ${f(s.y)} × ${f(s.z)} m`);
	if (entry.parts.size)
		lines.push(`Parts: ${[...entry.parts].slice(0, 8).join(", ")}${entry.parts.size > 8 ? ", …" : ""}`);
	return lines;
}
