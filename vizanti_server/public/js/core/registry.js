import { flattenSchema, resolveProps, coerce } from './properties.js';

export const DEFAULT_GLOBAL = { fixed_frame: "odom", background: "#273444" };

const GLOBAL_SCHEMA = {
	fixed_frame: { type: "string" },
	background: { type: "color" },
};

// The single model both shells render. It owns the live display instances, the global
// options and each shell's layout blob, and it is the only thing that gets saved.
export class Registry extends EventTarget {

	constructor({ types, context }) {
		super();
		this.types = types;
		this.context = context;
		this.items = [];
		this.orphans = []; // saved entries that could not be instantiated; written back unchanged
		this.global = { ...DEFAULT_GLOBAL };
		this.ui = {};
		this.uid = 0;
		this._loading = false;
	}

	_notify(name, detail = {}) {
		this.dispatchEvent(new CustomEvent(name, { detail }));
	}

	// For changes that must be persisted.
	_emit(name, detail = {}) {
		this._notify(name, detail);
		if (!this._loading)
			this._notify("changed", { cause: name });
	}

	_reorder() {
		this.items.forEach((item, index) => item._setOrder(index));
	}

	get(id) {
		return this.items.find((item) => item.id === id);
	}

	add(type, props = {}, opts = {}) {
		const Cls = this.types.get(type);
		if (!Cls)
			throw new Error(`Unknown display type "${type}"`);

		let id = opts.id;
		if (id === undefined) {
			do {
				id = `${type}_${this.uid++}`;
			} while (this.get(id));
		} else if (typeof id !== "string" || !/^[\w-]+$/.test(id)) {
			throw new Error(`Invalid display id "${id}"`);
		} else if (this.get(id)) {
			throw new Error(`Duplicate display id "${id}"`);
		}

		const item = new Cls(id, this.context);
		item.name = opts.name ?? Cls.label;
		item.container = typeof opts.container === "string" ? opts.container : ""; // folder the icon lives in
		item.status.onChange = () => this._notify("status", { item });
		item.onInfo = () => this._notify("info", { item });

		this.items.push(item);
		try {
			item._create(resolveProps(Cls.properties, props).values, opts.enabled ?? true);
		} catch (e) {
			this.items.pop();
			throw e;
		}
		this._reorder();
		this._emit("added", { item });
		return item;
	}

	remove(id) {
		const index = this.items.findIndex((item) => item.id === id);
		if (index === -1)
			return;
		const [item] = this.items.splice(index, 1);
		item._destroy();
		// widgets that lived in this item's folder go back to the main bar
		for (const other of this.items) {
			if (other.container === `${id}_widget_container`)
				other.container = "";
		}
		this._reorder();
		this._emit("removed", { item });
	}

	setProperty(id, key, value) {
		const item = this.get(id);
		if (!item)
			return { ok: false, error: `No display with id "${id}".` };
		const def = flattenSchema(item.constructor.properties)[key];
		if (!def)
			return { ok: false, error: `Unknown property "${key}".` };
		const r = coerce(def, value);
		if (!r.ok)
			return r;
		item._setProperty(key, r.value);
		this._emit("property", { item, key, value: r.value });
		return r;
	}

	setEnabled(id, enabled) {
		const item = this.get(id);
		if (!item)
			return;
		item._setEnabled(!!enabled);
		this._emit("enabled", { item });
	}

	move(id, index) {
		const from = this.items.findIndex((item) => item.id === id);
		if (from === -1)
			return;
		const to = Math.max(0, Math.min(this.items.length - 1, index));
		const [item] = this.items.splice(from, 1);
		this.items.splice(to, 0, item);
		this._reorder();
		this._emit("reordered");
	}

	setGlobal(key, value) {
		const def = GLOBAL_SCHEMA[key];
		if (!def)
			return { ok: false, error: `Unknown global option "${key}".` };
		const r = coerce(def, value);
		if (!r.ok)
			return r;
		this.global[key] = r.value;
		this._emit("global", { key, value: r.value });
		return r;
	}

	setUi(key, value) {
		this.ui[key] = value;
		this._emit("ui", { key });
	}

	toJSON() {
		return {
			version: 2,
			uid: this.uid,
			global: { ...this.global },
			ui: { ...this.ui },
			items: [
				...this.items.map((item) => ({
					id: item.id,
					type: item.constructor.type,
					name: item.name,
					enabled: item.enabled,
					container: item.container,
					props: { ...item.props },
				})),
				...this.orphans,
			],
		};
	}

	load(data) {
		this._loading = true;
		try {
			for (const item of [...this.items])
				this.remove(item.id);
			this.orphans = [];
			this.global = { ...DEFAULT_GLOBAL };
			this.ui = {};
			this.uid = 0;

			if (data !== null && typeof data === "object") {
				for (const key of Object.keys(GLOBAL_SCHEMA)) {
					const r = coerce(GLOBAL_SCHEMA[key], data.global?.[key]);
					if (r.ok)
						this.global[key] = r.value;
				}
				if (data.ui !== null && typeof data.ui === "object")
					this.ui = { ...data.ui };
				if (Number.isInteger(data.uid) && data.uid >= 0)
					this.uid = data.uid;

				for (const entry of Array.isArray(data.items) ? data.items : []) {
					// a hand-edited or damaged file can hold anything; only objects are entries
					if (entry === null || typeof entry !== "object" || Array.isArray(entry))
						continue;
					if (!this.types.has(entry.type)) {
						this.orphans.push(entry);
						continue;
					}
					try {
						this.add(entry.type, entry.props, { id: entry.id, name: entry.name, enabled: entry.enabled, container: entry.container });
					} catch (e) {
						console.warn(`Display "${entry.id}" could not be restored:`, e);
						this.orphans.push(entry);
					}
				}
			}
		} finally {
			this._loading = false;
		}
		this._notify("loaded");
	}
}
