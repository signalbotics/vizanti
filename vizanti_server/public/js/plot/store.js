// The data behind every plot panel on the page, as PlotJuggler's streaming buffer: one
// subscription per topic however many plots use it, and every numeric field of each subscribed
// topic recorded (not only the plotted ones), so a field dragged onto a plot shows its history
// at once. Samples older than the buffer length are dropped.
//
// Panels say which topics they need with want(owner, topics); the store subscribes to the
// union and drops subscriptions nobody needs (their samples stay until they age out).
// It talks to ROS only through the functions it is given, so it can be tested without a browser.

import { Series } from './series.js';
import { flattenMessage, stampSeconds, DEFAULT_MAX_ARRAY } from './flatten.js';

const QUEUE_LENGTH = 100;            // messages rosbridge may hold for us: every sample, not the latest
const TRIM_EVERY_MS = 1000;
const NO_DATA_RETRY_MS = 5000;        // subscribe again while nothing arrives (see Display), doubling
const NO_DATA_RETRY_MAX_MS = 60000;
const TYPE_RETRY_MS = 3000;           // a topic nobody publishes yet has no type to subscribe with
const RATE_WINDOW = 50;               // receive times kept per topic for its rate

export class PlotStore {

	// subscribe(topic, type, throttleMs, callback, qos, options) -> unsubscribe (the app's subscribe)
	// now() -> ROS time in seconds; resolveType(topic) -> Promise<type | null>
	// (the timer defaults are wrapped: a browser's setTimeout called as a method of the store throws)
	constructor({ subscribe, now = () => Date.now() / 1000, resolveType = async () => null,
		setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
		setRepeat = (fn, ms) => setInterval(fn, ms), clearRepeat = (id) => clearInterval(id) }) {
		this._subscribe = subscribe;
		this._now = now;
		this._resolveType = resolveType;
		this._setTimer = setTimer;
		this._clearTimer = clearTimer;
		this.settings = { buffer: 60, timeSource: "receive", maxArray: DEFAULT_MAX_ARRAY };
		this.topics = new Map();   // topic -> record (see _record)
		this.owners = new Map();   // owner -> Map(topic -> type)
		this.t0 = NaN;             // time of the first sample: plots show time since then
		this.latest = -Infinity;   // newest sample time
		this.version = 0;          // changes with every sample, for redraws
		this._listeners = new Set();
		this._structurePending = false;
		this._trimTimer = setRepeat(() => this.trim(), TRIM_EVERY_MS);
		this._clearRepeat = clearRepeat;
	}

	// ---- what is recorded ----

	// owner (a panel) needs these topics: Map or object of topic -> type ("" when not known)
	want(owner, topics) {
		const wanted = new Map(topics instanceof Map ? topics : Object.entries(topics ?? {}));
		if (wanted.size === 0)
			this.owners.delete(owner);
		else
			this.owners.set(owner, wanted);
		this._sync();
	}

	release(owner) {
		this.owners.delete(owner);
		this._sync();
	}

	_sync() {
		const needed = new Map();
		for (const topics of this.owners.values()) {
			for (const [topic, type] of topics) {
				if (!needed.get(topic))
					needed.set(topic, type ?? "");
			}
		}
		for (const [topic, record] of this.topics) {
			if (!needed.has(topic) && record.active)
				this._stop(record);
		}
		for (const [topic, type] of needed) {
			const record = this._record(topic);
			if (type && !record.type)
				record.type = type;
			if (!record.active)
				this._start(record);
		}
		this._structureChanged();
	}

	_record(topic) {
		let record = this.topics.get(topic);
		if (!record) {
			record = {
				topic, type: "", active: false, unsubscribe: null, timer: null, attempts: 0, seq: 0,
				fields: new Map(), skipped: new Map(), count: 0, receiveTimes: [], status: "",
			};
			this.topics.set(topic, record);
		}
		return record;
	}

	_start(record) {
		record.active = true;
		record.attempts = 0;
		this._subscribeRecord(record);
	}

	_stop(record) {
		record.active = false;
		record.seq++;
		this._clearTimer(record.timer);
		record.timer = null;
		record.unsubscribe?.();
		record.unsubscribe = null;
		record.status = "";
	}

	_subscribeRecord(record) {
		const seq = ++record.seq;
		this._clearTimer(record.timer);
		record.unsubscribe?.();
		record.unsubscribe = null;
		if (!record.type) {
			record.status = "Looking up the message type…";
			this._resolveType(record.topic).then((type) => {
				if (seq !== record.seq || !record.active)
					return;
				if (type) {
					record.type = type;
					this._subscribeRecord(record);
				} else {
					record.status = "Not published yet; waiting for a publisher.";
					record.timer = this._setTimer(() => seq === record.seq && record.active && this._subscribeRecord(record), TYPE_RETRY_MS);
				}
				this._structureChanged();
			}, () => {
				if (seq === record.seq && record.active)
					record.timer = this._setTimer(() => this._subscribeRecord(record), TYPE_RETRY_MS);
			});
			return;
		}
		record.status = record.count ? "" : "No data received yet.";
		const receivedBefore = record.count;
		record.unsubscribe = this._subscribe(record.topic, record.type, 0, (msg) => this._message(record, msg), null, { queueLength: QUEUE_LENGTH });
		// rosbridge matches QoS to the publishers there are when it subscribes; with none it picks
		// volatile / best effort and can miss later ones. While nothing arrives, subscribe again.
		const delay = Math.min(NO_DATA_RETRY_MAX_MS, NO_DATA_RETRY_MS * 2 ** record.attempts);
		record.timer = this._setTimer(() => {
			if (seq === record.seq && record.active && record.count === receivedBefore) {
				record.attempts++;
				this._subscribeRecord(record);
			}
		}, delay);
	}

	// ---- samples ----

	_message(record, msg) {
		if (!record.active)
			return;
		const received = this._now();
		let t = received;
		if (this.settings.timeSource === "header") {
			const stamp = stampSeconds(msg);
			if (stamp !== null)
				t = stamp;
		}
		const { values, skipped } = flattenMessage(msg, { maxArray: this.settings.maxArray });
		let added = false;
		for (const [field, value] of values) {
			let series = record.fields.get(field);
			if (!series) {
				series = new Series();
				record.fields.set(field, series);
				added = true;
			}
			series.push(t, value);
		}
		for (const [field, reason] of skipped) {
			if (!record.skipped.has(field)) {
				record.skipped.set(field, reason);
				added = true;
			}
		}
		if (record.count === 0) {
			record.status = "";
			added = true;
		}
		record.count++;
		record.attempts = 0;
		record.receiveTimes.push(received);
		if (record.receiveTimes.length > RATE_WINDOW)
			record.receiveTimes.shift();
		if (Number.isNaN(this.t0) || t < this.t0)
			this.t0 = t;
		if (t > this.latest)
			this.latest = t;
		this.version++;
		if (added)
			this._structureChanged();
		this._dataArrived();
	}

	// new samples: wake the panels' draw loops, at most once per task
	_dataArrived() {
		if (this._dataPending)
			return;
		this._dataPending = true;
		queueMicrotask(() => {
			this._dataPending = false;
			this._emit({ kind: "data" });
		});
	}

	// drops samples older than the buffer length (measured back from the newest sample)
	trim() {
		if (!Number.isFinite(this.latest))
			return;
		const cutoff = this.latest - this.settings.buffer;
		let changed = false;
		for (const record of this.topics.values()) {
			for (const series of record.fields.values()) {
				if (series.length && series.firstTime < cutoff) {
					series.trimBefore(cutoff);
					changed = true;
				}
			}
		}
		if (changed) {
			if (this.t0 < cutoff)
				this.t0 = this._earliest();
			this.version++;
		}
	}

	_earliest() {
		let t = Infinity;
		for (const record of this.topics.values()) {
			for (const series of record.fields.values()) {
				if (series.length && series.firstTime < t)
					t = series.firstTime;
			}
		}
		return t === Infinity ? NaN : t;
	}

	// forgets every sample (the fields stay listed)
	clear() {
		for (const record of this.topics.values()) {
			for (const series of record.fields.values())
				series.clear();
			record.receiveTimes = [];
		}
		this.t0 = NaN;
		this.latest = -Infinity;
		this.version++;
		this._emit({ kind: "cleared" });
	}

	// buffer (s), timeSource ("receive" | "header"), maxArray; changing the time source starts over,
	// since times from the two sources do not line up
	setSettings(changes) {
		const next = { ...this.settings };
		if (Number.isFinite(changes.buffer) && changes.buffer > 0)
			next.buffer = changes.buffer;
		if (changes.timeSource === "receive" || changes.timeSource === "header")
			next.timeSource = changes.timeSource;
		if (Number.isFinite(changes.maxArray) && changes.maxArray >= 1)
			next.maxArray = Math.round(changes.maxArray);
		const changed = Object.keys(next).filter((k) => next[k] !== this.settings[k]);
		if (changed.length === 0)
			return;
		const restart = next.timeSource !== this.settings.timeSource;
		this.settings = next;
		if (restart)
			this.clear();
		this.trim();
		this._emit({ kind: "settings", settings: { ...next } });
	}

	// ---- queries ----

	series(topic, field) {
		return this.topics.get(topic)?.fields.get(field) ?? null;
	}

	// fields of a topic in the order its messages list them
	fieldsOf(topic) {
		return [...(this.topics.get(topic)?.fields.keys() ?? [])];
	}

	// { type, active, count, rate (Hz), status, skipped: [[field, reason]] } or null
	info(topic) {
		const record = this.topics.get(topic);
		if (!record)
			return null;
		const times = record.receiveTimes;
		const span = times.length > 1 ? times[times.length - 1] - times[0] : 0;
		const fresh = times.length > 0 && this._now() - times[times.length - 1] < 5;
		return {
			type: record.type,
			active: record.active,
			count: record.count,
			rate: fresh && span > 0 ? (times.length - 1) / span : 0,
			status: record.status,
			skipped: [...record.skipped],
		};
	}

	// ---- events: { kind: "data" | "structure" | "settings" | "cleared" } ----

	on(listener) {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	_emit(event) {
		for (const listener of [...this._listeners]) {
			try {
				listener(event);
			} catch (e) {
				console.error("Plot store listener failed:", e);
			}
		}
	}

	// new fields or topics: tell the series browsers, at most once per task
	_structureChanged() {
		if (this._structurePending)
			return;
		this._structurePending = true;
		queueMicrotask(() => {
			this._structurePending = false;
			this._emit({ kind: "structure" });
		});
	}

	destroy() {
		for (const record of this.topics.values())
			this._stop(record);
		this._clearRepeat(this._trimTimer);
		this._listeners.clear();
	}
}

// one store per app (the display context), shared by its plot panels
const stores = new WeakMap();
export function plotStoreFor(ctx) {
	let store = stores.get(ctx);
	if (!store) {
		store = new PlotStore({
			subscribe: ctx.subscribe,
			now: ctx.rosTime ?? (() => Date.now() / 1000),
			resolveType: ctx.resolveType ?? (async () => null),
		});
		stores.set(ctx, store);
	}
	return store;
}
