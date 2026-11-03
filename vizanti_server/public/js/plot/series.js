// One plotted signal: (time, value) samples in time order, in two Float64Arrays. The samples sit
// in one contiguous run [start, start + length) so a time range is found with a binary search
// and drawn without copying; old samples are dropped by moving `start`, and the arrays are
// compacted or grown when the run reaches their end (amortised O(1) per sample).

const INITIAL_CAPACITY = 256;

export class Series {

	constructor(capacity = INITIAL_CAPACITY) {
		this.times = new Float64Array(capacity);
		this.values = new Float64Array(capacity);
		this.start = 0;
		this.length = 0;
		this.version = 0; // changes with every edit, for caches
	}

	timeAt(i) {
		return this.times[this.start + i];
	}

	valueAt(i) {
		return this.values[this.start + i];
	}

	get firstTime() {
		return this.length ? this.times[this.start] : NaN;
	}

	get lastTime() {
		return this.length ? this.times[this.start + this.length - 1] : NaN;
	}

	get lastValue() {
		return this.length ? this.values[this.start + this.length - 1] : NaN;
	}

	// the first index whose time is >= t (length when there is none)
	lowerBound(t) {
		let lo = 0;
		let hi = this.length;
		const times = this.times;
		const base = this.start;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (times[base + mid] < t)
				lo = mid + 1;
			else
				hi = mid;
		}
		return lo;
	}

	// the index of the last sample at or before t, or -1
	indexAtOrBefore(t) {
		const i = this.lowerBound(t);
		if (i < this.length && this.timeAt(i) === t)
			return i;
		return i - 1;
	}

	push(t, v) {
		if (!Number.isFinite(t))
			return;
		if (this.start + this.length === this.times.length)
			this._makeRoom();
		const end = this.start + this.length;
		if (this.length === 0 || t >= this.times[end - 1]) {
			this.times[end] = t;
			this.values[end] = v;
		} else {
			// out of order (header stamps from several publishers): insert where it belongs
			const at = this.start + this.lowerBound(t);
			this.times.copyWithin(at + 1, at, end);
			this.values.copyWithin(at + 1, at, end);
			this.times[at] = t;
			this.values[at] = v;
		}
		this.length++;
		this.version++;
	}

	// drops the samples older than t
	trimBefore(t) {
		const n = this.lowerBound(t);
		if (n === 0)
			return;
		this.start += n;
		this.length -= n;
		this.version++;
	}

	clear() {
		this.start = 0;
		this.length = 0;
		this.version++;
	}

	_makeRoom() {
		const capacity = this.times.length;
		if (this.start >= capacity / 2) {
			// half the array is dropped samples: slide the live run to the front
			this.times.copyWithin(0, this.start, this.start + this.length);
			this.values.copyWithin(0, this.start, this.start + this.length);
		} else {
			const times = new Float64Array(capacity * 2);
			const values = new Float64Array(capacity * 2);
			times.set(this.times.subarray(this.start, this.start + this.length));
			values.set(this.values.subarray(this.start, this.start + this.length));
			this.times = times;
			this.values = values;
		}
		this.start = 0;
	}
}
