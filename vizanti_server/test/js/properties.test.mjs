import test from 'node:test';
import assert from 'node:assert/strict';
import { flattenSchema, defaultsOf, coerce, resolveProps, enumValues } from '../../public/js/core/properties.js';

const schema = {
	topic: { type: "topic" },
	size: { type: "float", default: 0.05, min: 0.01, max: 1 },
	count: { type: "int", default: 3, min: 1, max: 20 },
	on: { type: "bool", default: true },
	color: { type: "color", default: "#ff0000" },
	mode: { type: "enum", options: ["Off", { value: "fine", label: "Fine" }] },
	style: {
		type: "group", label: "Style", properties: {
			name: { type: "string", default: "x" },
			vis: { type: "object" },
		},
	},
};

test('flattenSchema lifts group members to the top level', () => {
	assert.deepEqual(Object.keys(flattenSchema(schema)), ["topic", "size", "count", "on", "color", "mode", "name", "vis"]);
});

test('flattenSchema rejects bad declarations', () => {
	assert.throws(() => flattenSchema({ a: { type: "colour" } }), /unknown type "colour"/);
	assert.throws(() => flattenSchema({ a: { type: "enum" } }), /needs a non-empty options list/);
	assert.throws(() => flattenSchema({ a: { type: "int" }, g: { type: "group", properties: { a: { type: "int" } } } }), /declared twice/);
});

test('defaultsOf uses declared defaults, then per-type defaults', () => {
	assert.deepEqual(defaultsOf(schema), {
		topic: "", size: 0.05, count: 3, on: true, color: "#ff0000", mode: "Off", name: "x", vis: {},
	});
});

test('defaultOf returns a fresh copy of object defaults', () => {
	const s = { vis: { type: "object", default: { a: 1 } } };
	const a = defaultsOf(s).vis;
	a.a = 2;
	assert.deepEqual(defaultsOf(s).vis, { a: 1 });
});

test('enumValues reads plain and labelled options', () => {
	assert.deepEqual(enumValues(schema.mode), ["Off", "fine"]);
});

test('coerce: numbers are parsed, rounded and clamped', () => {
	const f = flattenSchema(schema);
	assert.deepEqual(coerce(f.size, "0.5"), { ok: true, value: 0.5 });
	assert.deepEqual(coerce(f.size, 50), { ok: true, value: 1 });
	assert.deepEqual(coerce(f.size, -3), { ok: true, value: 0.01 });
	assert.deepEqual(coerce(f.count, "7.6"), { ok: true, value: 8 });
	assert.deepEqual(coerce(f.count, 999), { ok: true, value: 20 });
});

test('coerce: empty, non-numeric and non-finite numbers are rejected, never NaN', () => {
	const f = flattenSchema(schema);
	for (const bad of ["", "abc", NaN, Infinity, null, undefined, {}]) {
		const r = coerce(f.size, bad);
		assert.equal(r.ok, false, `float ${String(bad)}`);
		assert.match(r.error, /number/);
		assert.equal(coerce(f.count, bad).ok, false, `int ${String(bad)}`);
	}
});

test('coerce: bool, color, enum, string, object', () => {
	const f = flattenSchema(schema);
	assert.deepEqual(coerce(f.on, "false"), { ok: true, value: false });
	assert.deepEqual(coerce(f.on, true), { ok: true, value: true });
	assert.equal(coerce(f.on, "yes").ok, false);
	assert.deepEqual(coerce(f.color, "#AABBCC"), { ok: true, value: "#aabbcc" });
	assert.equal(coerce(f.color, "red").ok, false);
	assert.deepEqual(coerce(f.mode, "fine"), { ok: true, value: "fine" });
	assert.equal(coerce(f.mode, "Fine").ok, false);
	assert.deepEqual(coerce(f.name, "hello"), { ok: true, value: "hello" });
	assert.equal(coerce(f.name, 5).ok, false);
	assert.deepEqual(coerce(f.topic, "/scan"), { ok: true, value: "/scan" });
	assert.deepEqual(coerce(f.vis, { a: true }), { ok: true, value: { a: true } });
	assert.equal(coerce(f.vis, [1]).ok, false);
	assert.equal(coerce(f.vis, null).ok, false);
});

test('resolveProps keeps valid saved values, defaults the rest, ignores unknown keys', () => {
	const r = resolveProps(schema, { size: 0.2, count: "abc", gone: 1, topic: "/scan" });
	assert.equal(r.values.size, 0.2);
	assert.equal(r.values.count, 3);
	assert.equal(r.values.topic, "/scan");
	assert.equal("gone" in r.values, false);
	assert.deepEqual(r.rejected, ["count"]);
});

test('resolveProps accepts a missing saved object', () => {
	assert.deepEqual(resolveProps(schema, undefined).values, defaultsOf(schema));
});
