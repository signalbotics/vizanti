// Loads the plugin classes other ROS packages install (see scripts/plugin_index.py on the server
// and docs/plugins.md): displays and panels become display types, tools become tool plugins.

export const DEFAULT_ICONS = { display: "assets/marker.svg", panel: "assets/inspector.svg", tool: "assets/toolbar/point.svg" };

// The class a manifest entry names: its `export`, or else the one exported class that extends `base`.
export function pickExport(module, entry, base) {
	if (entry.export)
		return module[entry.export] ?? null;
	const found = Object.values(module).filter((value) => typeof value === "function" && base.prototype.isPrototypeOf(value.prototype));
	return found.length === 1 ? found[0] : null;
}

// Copies what the plugin description says onto the class. The type is always the described
// name ("pkg/Name"), as RViz names its classes; label, description and icon only fill in what
// the class does not set itself.
export function applyPluginInfo(Cls, entry, iconBase) {
	const own = (key) => Object.hasOwn(Cls, key) && Cls[key];
	Cls.type = entry.name;
	if (!own("label"))
		Cls.label = entry.name.split("/").pop();
	if (!own("description"))
		Cls.description = entry.description;
	if (entry.icon)
		Cls.icon = `${iconBase}/plugin_icons/${entry.icon}`;
	else if (!own("icon"))
		Cls.icon = DEFAULT_ICONS[entry.kind];
	if (!own("category"))
		Cls.category = entry.package; // the Add dialog groups by package, as RViz does
	if (entry.rviz_class && !own("rvizClass"))
		Cls.rvizClass = entry.rviz_class;
	Cls.plugin = { package: entry.package, name: entry.name, kind: entry.kind };
	return Cls;
}

// manifest: { classes, legacy, problems } from the server. importModule(path) imports a
// plugin module. bases: { display, panel, tool } base classes. Fills `types` (display type
// -> class) and `tools` (tool type -> class); reports problems through notify(text).
export async function loadPlugins({ manifest, importModule, bases, types, tools, iconBase, notify }) {
	for (const entry of manifest.classes ?? []) {
		const base = bases[entry.kind];
		let Cls = null;
		try {
			Cls = pickExport(await importModule(entry.module), entry, base);
		} catch (e) {
			console.error(`Plugin ${entry.name} (${entry.module}) failed to load:`, e);
			notify(`Plugin "${entry.name}" failed to load. See the browser console.`);
			continue;
		}
		if (!Cls || !base.prototype.isPrototypeOf(Cls.prototype)) {
			notify(`Plugin "${entry.name}": ${entry.module} has no ${entry.export ? `class "${entry.export}"` : "single exported class"} extending the ${entry.kind} base class.`);
			continue;
		}
		applyPluginInfo(Cls, entry, iconBase);
		const target = entry.kind === "tool" ? tools : types;
		if (target.has(Cls.type)) {
			notify(`Plugin "${entry.name}" was not loaded: a ${entry.kind} of that name already exists.`);
			continue;
		}
		target.set(Cls.type, Cls);
	}

	// the older form: every exported class with a static `type` in vizanti/displays/*.js
	for (const path of manifest.legacy ?? []) {
		try {
			const module = await importModule(path);
			for (const value of Object.values(module)) {
				if (typeof value !== "function" || typeof value.type !== "string" || value.type === "")
					continue;
				if (types.has(value.type)) {
					notify(`Plugin ${path} defines the display type "${value.type}", which already exists; it was not loaded.`);
					continue;
				}
				types.set(value.type, value);
			}
		} catch (e) {
			console.error(`Display plugin ${path} failed to load:`, e);
			notify(`Display plugin ${path} failed to load. See the browser console.`);
		}
	}
}
