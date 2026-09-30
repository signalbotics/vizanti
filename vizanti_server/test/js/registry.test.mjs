import test from 'node:test';
import assert from 'node:assert/strict';
import { Registry, DEFAULT_GLOBAL } from '../../public/js/core/registry.js';

class Fake {
	static type = "fake";
	static label = "Fake";
	static properties = {
		topic: { type: "topic" },
		size: { type: "float", default: 1, min: 0, max: 10 },
	};
	constructor(id, ctx) {
		this.id = id;
		this.ctx = ctx;
		this.name = "Fake";
		this.props = {};
		this.enabled = true;
		this.status = { onChange: null };
		this.onInfo = null;
		this.calls = [];
	}
	_create(values, enabled) { this.props = { ...values }; this.enabled = enabled; this.calls.push("create"); }
	_setProperty(k, v) { this.props[k] = v; this.calls.push(`set:${k}`); }
	_setEnabled(e) { this.enabled = e; }
	_setOrder(n) { this.order = n; }
	_destroy() { this.calls.push("destroy"); }
}

class Broken extends Fake {
	static type = "broken";
	_create() { throw new Error("cannot start"); }
}

function make() {
	const context = { marker: true };
	const reg = new Registry({ types: new Map([["fake", Fake], ["broken", Broken]]), context });
	const events = [];
	for (const name of ["added", "removed", "property", "enabled", "reordered", "global", "ui", "loaded", "status", "info", "changed"])
		reg.addEventListener(name, (e) => events.push(name === "changed" ? `changed:${e.detail.cause}` : name));
	return { reg, events, context };
}

test('add creates an instance with resolved properties and the shared context', () => {
	const { reg, events, context } = make();
	const item = reg.add("fake", { size: 4 });
	assert.equal(item.id, "fake_0");
	assert.equal(item.ctx, context);
	assert.deepEqual(item.props, { topic: "", size: 4 });
	assert.equal(item.order, 0);
	assert.deepEqual(events, ["added", "changed:added"]);
});

test('add generates unique ids and rejects unknown types and duplicate ids', () => {
	const { reg } = make();
	reg.add("fake", {}, { id: "fake_1" });
	assert.equal(reg.add("fake").id, "fake_0");
	assert.equal(reg.add("fake").id, "fake_2");
	assert.throws(() => reg.add("nope"), /Unknown display type "nope"/);
	assert.throws(() => reg.add("fake", {}, { id: "fake_0" }), /Duplicate display id/);
});

test('an item whose _create throws is not left in the list', () => {
	const { reg } = make();
	assert.throws(() => reg.add("broken"), /cannot start/);
	assert.equal(reg.items.length, 0);
});

test('setProperty validates before it reaches the instance', () => {
	const { reg } = make();
	const item = reg.add("fake");
	assert.deepEqual(reg.setProperty(item.id, "size", "50"), { ok: true, value: 10 });
	assert.equal(item.props.size, 10);
	assert.equal(reg.setProperty(item.id, "size", "abc").ok, false);
	assert.equal(item.props.size, 10);
	assert.match(reg.setProperty(item.id, "nope", 1).error, /Unknown property/);
	assert.match(reg.setProperty("missing", "size", 1).error, /No display/);
});

test('setEnabled, move and remove update the list and notify', () => {
	const { reg, events } = make();
	const a = reg.add("fake"), b = reg.add("fake"), c = reg.add("fake");
	events.length = 0;
	reg.setEnabled(a.id, false);
	assert.equal(a.enabled, false);
	reg.move(c.id, 0);
	assert.deepEqual(reg.items.map((i) => i.id), [c.id, a.id, b.id]);
	assert.deepEqual(reg.items.map((i) => i.order), [0, 1, 2]);
	reg.move(c.id, 99);
	assert.deepEqual(reg.items.map((i) => i.id), [a.id, b.id, c.id]);
	reg.remove(b.id);
	assert.deepEqual(b.calls.at(-1), "destroy");
	assert.deepEqual(reg.items.map((i) => i.order), [0, 1]);
	assert.deepEqual(events, [
		"enabled", "changed:enabled", "reordered", "changed:reordered",
		"reordered", "changed:reordered", "removed", "changed:removed",
	]);
});

test('setGlobal validates and rejects unknown keys', () => {
	const { reg } = make();
	assert.deepEqual(reg.global, DEFAULT_GLOBAL);
	assert.deepEqual(reg.setGlobal("background", "#AA0000"), { ok: true, value: "#aa0000" });
	assert.equal(reg.setGlobal("background", "red").ok, false);
	assert.equal(reg.setGlobal("nope", 1).ok, false);
	assert.equal(reg.global.background, "#aa0000");
});

test('status and info notifications are forwarded but do not mark the layout changed', () => {
	const { reg, events } = make();
	const item = reg.add("fake");
	events.length = 0;
	item.status.onChange();
	item.onInfo();
	assert.deepEqual(events, ["status", "info"]);
});

test('toJSON and load round-trip items, global options and ui blobs', () => {
	const a = make();
	a.reg.add("fake", { size: 2, topic: "/x" });
	a.reg.setEnabled("fake_0", false);
	a.reg.setGlobal("fixed_frame", "map");
	a.reg.setUi("camera", { mode: "orbit" });
	const json = JSON.parse(JSON.stringify(a.reg.toJSON()));

	const b = make();
	b.reg.load(json);
	assert.deepEqual(b.reg.toJSON(), json);
	assert.equal(b.reg.items[0].enabled, false);
	// loading announces each restored item but never marks the layout as changed
	assert.deepEqual(b.events, ["added", "loaded"]);
	assert.equal(b.reg.add("fake").id, "fake_1");
});

test('load keeps entries of unknown or failing types as orphans and saves them back', () => {
	const { reg } = make();
	const unknown = { id: "lidar3d_0", type: "lidar3d", name: "Lidar", enabled: true, props: { a: 1 } };
	const failing = { id: "broken_0", type: "broken", name: "B", enabled: true, props: {} };
	reg.load({ version: 2, uid: 5, global: {}, ui: {}, items: [unknown, { id: "fake_0", type: "fake", props: {} }, failing] });
	assert.deepEqual(reg.items.map((i) => i.id), ["fake_0"]);
	const saved = reg.toJSON().items;
	assert.deepEqual(saved.filter((i) => i.type !== "fake"), [unknown, failing]);
});

test('load replaces what was there and tolerates null and partial data', () => {
	const { reg } = make();
	const old = reg.add("fake");
	reg.load({ version: 2, items: [{ type: "fake" }], global: { background: "nonsense", extra: 1 } });
	assert.equal(old.calls.at(-1), "destroy");
	assert.equal(reg.items.length, 1);
	assert.deepEqual(reg.global, DEFAULT_GLOBAL);
	reg.load(null);
	assert.equal(reg.items.length, 0);
});

test('load keeps going past items that are not objects, and keeps them out of the live list', () => {
	const { reg } = make();
	assert.doesNotThrow(() => reg.load({ version: 2, items: [null, 5, "x", [1], { type: "fake" }] }));
	assert.equal(reg.items.length, 1);
	assert.equal(reg.toJSON().items.length, 1);
});
