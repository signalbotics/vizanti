// Converts the settings object of the original 2D UI (localStorage key "settings", and the
// default_widget_config files written for it) into a version 2 layout.

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const finite = (v) => typeof v === "number" && Number.isFinite(v);

export function isLegacyLayout(data) {
	return isObject(data) && Array.isArray(data.navbar);
}

// classes: Map of type -> item class, used to tell native displays from template widgets
export function convertLegacyLayout(old, classes) {
	const out = {
		version: 2,
		uid: Number.isInteger(old.uid) && old.uid >= 0 ? old.uid : 0,
		global: {},
		ui: {},
		items: [],
	};

	for (const entry of old.navbar) {
		if (!isObject(entry) || typeof entry.type !== "string" || typeof entry.id !== "string")
			continue;
		const state = isObject(old[entry.id]) ? old[entry.id] : {};

		// the settings widget is now the Global Options
		if (entry.type === "settings") {
			if (typeof state.fixed_frame === "string" && state.fixed_frame !== "")
				out.global.fixed_frame = state.fixed_frame;
			if (typeof state.background_color === "string")
				out.global.background = state.background_color;
			continue;
		}

		const Cls = classes.get(entry.type);
		let props;
		if (Cls && Cls.kind !== "template") {
			// native displays kept the old option names; fromLegacy covers the few that changed
			props = typeof Cls.fromLegacy === "function" ? Cls.fromLegacy(state) : state;
		} else {
			// template widgets (and types that are not loaded) read their state back themselves
			props = { topic: typeof state.topic === "string" ? state.topic : "", state };
		}

		out.items.push({
			id: entry.id,
			type: entry.type,
			enabled: true,
			container: typeof entry.container_id === "string" && entry.container_id !== "icon_container" ? entry.container_id : "",
			props,
		});
	}

	const view = old.view;
	if (isObject(view) && isObject(view.center) && finite(view.center.x) && finite(view.center.y) && finite(view.scale)) {
		// the old view stored the centre with y pointing down the screen
		out.ui.camera = { mode: "topdown", topdown: { x: view.center.x, y: -view.center.y, zoom: view.scale } };
	}

	return out;
}
