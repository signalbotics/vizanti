import test from 'node:test';
import assert from 'node:assert/strict';
import { pickExport, applyPluginInfo, loadPlugins, DEFAULT_ICONS } from '../../public/js/core/plugins.js';
import { ToolManager } from '../../public/js/core/tools.js';

class Display {}
class Panel extends Display {}
class Tool {}
const bases = { display: Display, panel: Panel, tool: Tool };
const entry = (over = {}) => ({ package: "my_pkg", name: "my_pkg/Battery Graph", kind: "display", module: "my_pkg/displays/graph.js", export: null, description: "Plots it.", icon: null, rviz_class: null, ...over });

test('pickExport takes the named export, or the single class extending the base', () => {
	class A extends Display {}
	class B extends Display {}
	assert.equal(pickExport({ A, helper: () => 1, VALUE: 3 }, entry(), Display), A);
	assert.equal(pickExport({ A, B }, entry(), Display), null); // ambiguous
	assert.equal(pickExport({ A, B }, entry({ export: "B" }), Display), B);
	assert.equal(pickExport({ A }, entry({ export: "Nope" }), Display), null);
});

test('applyPluginInfo names the class like RViz and fills only what the class leaves out', () => {
	class Graph extends Display { static label = "My own label"; }
	applyPluginInfo(Graph, entry({ icon: "my_pkg/classes/Battery Graph.svg", rviz_class: "other/Battery" }), "/base");
	assert.equal(Graph.type, "my_pkg/Battery Graph");
	assert.equal(Graph.label, "My own label");
	assert.equal(Graph.description, "Plots it.");
	assert.equal(Graph.icon, "/base/plugin_icons/my_pkg/classes/Battery Graph.svg");
	assert.equal(Graph.category, "my_pkg");
	assert.equal(Graph.rvizClass, "other/Battery");
	assert.deepEqual(Graph.plugin, { package: "my_pkg", name: "my_pkg/Battery Graph", kind: "display" });
	class Plain extends Display {}
	applyPluginInfo(Plain, entry({ kind: "panel" }), "");
	assert.equal(Plain.label, "Battery Graph");
	assert.equal(Plain.icon, DEFAULT_ICONS.panel);
});

test('loadPlugins sorts displays, panels and tools, and reports what does not fit', async () => {
	class Graph extends Display {}
	class Nav extends Panel {}
	class Goal extends Tool {}
	class Old { static type = "old_type"; }
	const modules = {
		"a/graph.js": { Graph },
		"a/nav.js": { Nav },
		"a/goal.js": { Goal },
		"a/notatool.js": { Graph },
		"old/displays/x.js": { Old, helper: () => {} },
	};
	const types = new Map([["grid", class {}]]);
	const tools = new Map();
	const notes = [];
	await loadPlugins({
		manifest: {
			classes: [
				entry({ name: "a/Graph", module: "a/graph.js" }),
				entry({ name: "a/Nav", kind: "panel", module: "a/nav.js" }),
				entry({ name: "a/Goal", kind: "tool", module: "a/goal.js" }),
				entry({ name: "a/Wrong", kind: "tool", module: "a/notatool.js" }),
				entry({ name: "a/Broken", module: "a/missing.js" }),
				entry({ name: "a/Graph", module: "a/graph.js" }), // a second class of the same name
			],
			legacy: ["old/displays/x.js"],
		},
		importModule: async (path) => {
			if (!modules[path])
				throw new Error("404");
			return modules[path];
		},
		bases, types, tools, iconBase: "", notify: (text) => notes.push(text),
	});
	assert.deepEqual([...types.keys()], ["grid", "a/Graph", "a/Nav", "old_type"]);
	assert.deepEqual([...tools.keys()], ["a/Goal"]);
	assert.equal(notes.length, 3);
	assert.match(notes[0], /a\/Wrong.*tool base class/);
	assert.match(notes[1], /a\/Broken.*failed to load/);
	assert.match(notes[2], /already exists/);
});

test('plugin tools: shown ones join the tool list, get the pointer while active and can hand back', () => {
	const calls = [];
	class Pin {
		static type = "a/Pin"; static label = "Drop pin"; static key = "x"; static hint = "Click to drop a pin.";
		constructor(api) { this.api = api; }
		onActivate() { calls.push("activate"); }
		onDeactivate() { calls.push("deactivate"); }
		onPointer(kind, event) { calls.push(`${kind}@${event.clientX}`); if (kind === "up") this.api.done(); }
	}
	const deps = { setInputEnabled() {}, requestRender() {}, fixedFrame: () => "map", now: () => 0 };
	const tools = new ToolManager(deps);
	tools.registerPlugin(Pin, { publish() {} });
	assert.equal(tools.list().some((t) => t.id === "a/Pin"), false); // installed but not added
	assert.deepEqual(tools.available().map((t) => t.id), ["a/Pin"]);
	const changes = [];
	tools.onToolsChange = (shown) => changes.push(shown);
	tools.setShown(["a/Pin", "a/Pin", 7]);
	assert.deepEqual(tools.shown, ["a/Pin"]);
	assert.deepEqual(tools.list().at(-1), { id: "a/Pin", label: "Drop pin", key: "x", hint: "Click to drop a pin.", icon: undefined, plugin: true });
	tools.key("x");
	assert.equal(tools.active, "a/Pin");
	tools.pointer("down", { clientX: 5, button: 0 });
	tools.pointer("up", { clientX: 6, button: 0 });
	assert.deepEqual(calls, ["activate", "down@5", "up@6", "deactivate"]);
	assert.equal(tools.active, "move");
	// a tool taken out while active hands the view back
	tools.select("a/Pin");
	tools.setShown([]);
	assert.equal(tools.active, "move");
	assert.equal(tools.list().some((t) => t.id === "a/Pin"), false);
	assert.equal(changes.length, 2);
});
