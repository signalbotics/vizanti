export const STORAGE_KEY = "vizanti_v2";

export function isLayout(data) {
	return data !== null && typeof data === "object" && !Array.isArray(data)
		&& data.version === 2 && Array.isArray(data.items);
}

// Browsers throw on the localStorage getter itself when site data is blocked.
// get() returns the real backend; if it throws or yields nothing, state lives in memory
// for this page only.
export function resolveBackend(get) {
	try {
		const backend = get();
		if (backend)
			return backend;
	} catch (e) { /* storage blocked */ }

	const data = new Map();
	return {
		getItem: (key) => (data.has(key) ? data.get(key) : null),
		setItem: (key, value) => { data.set(key, String(value)); },
		removeItem: (key) => { data.delete(key); },
	};
}

// backend has the shape of localStorage: getItem, setItem, removeItem.
export function createStorage(backend, key = STORAGE_KEY) {
	return {
		load() {
			let raw;
			try {
				raw = backend.getItem(key);
			} catch (e) {
				return { data: null, corrupt: false };
			}
			if (raw === null || raw === undefined)
				return { data: null, corrupt: false };
			try {
				const data = JSON.parse(raw);
				if (!isLayout(data))
					throw new Error("not a version 2 layout");
				return { data, corrupt: false };
			} catch (e) {
				// keep the unreadable data so nothing the user built is lost
				try { backend.setItem(key + "_backup", raw); } catch (e2) { /* storage unavailable */ }
				return { data: null, corrupt: true };
			}
		},

		save(data) {
			try {
				backend.setItem(key, JSON.stringify(data));
				return true;
			} catch (e) {
				return false;
			}
		},

		clear() {
			try { backend.removeItem(key); } catch (e) { /* storage unavailable */ }
		},
	};
}
