import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRect, SelectionEntry, combineSelections, entryLines } from '../../public/js/geometry/selection.js';
import { ToolManager } from '../../public/js/core/tools.js';

test('normalizeRect orders the corners', () => {
	assert.deepEqual(normalizeRect(50, 10, 20, 40), { left: 20, top: 10, right: 50, bottom: 40 });
});

test('a selection entry counts points and objects, with centre and extent', () => {
	const e = new SelectionEntry("scan_0", "Scan", "Laser Scan");
	e.addPoint(0, 0, 0, 3);
	e.addPoint(2, 4, 0, 4);
	e.addObject(1, 2, 3, "base_link");
	assert.equal(e.count, 3);
	assert.deepEqual(e.centroid, { x: 1, y: 2, z: 1 });
	assert.deepEqual(e.size, { x: 2, y: 4, z: 3 });
	assert.deepEqual(e.samples.map((s) => s.index), [3, 4]);
	const lines = entryLines(e);
	assert.equal(lines[0], "Scan (Laser Scan)");
	assert.equal(lines[1], "2 points, 1 object");
	assert.equal(lines[2], "Centre: 1.000, 2.000, 1.000");
	assert.ok(lines.includes("Parts: base_link"));
});

test('shift adds a box to the selection, merging the same display', () => {
	const a = new SelectionEntry("s", "Scan", "Laser Scan");
	a.addPoint(0, 0, 0, 0);
	const b = new SelectionEntry("s", "Scan", "Laser Scan");
	b.addPoint(10, 0, 0, 1);
	const c = new SelectionEntry("m", "Map", "Map");
	c.addObject(5, 5, 0);
	const first = new Map([["s", a]]);
	const replaced = combineSelections(first, new Map([["m", c]]), false);
	assert.deepEqual([...replaced.keys()], ["m"]);
	const added = combineSelections(first, new Map([["s", b], ["m", c]]), true);
	assert.deepEqual([...added.keys()], ["s", "m"]);
	assert.equal(added.get("s").points, 2);
	assert.equal(added.get("s").max[0], 10);
	assert.equal(a.points, 1); // the earlier selection is not changed
});

test('the select tool: a click inspects, a drag selects a box, shift + drag adds', () => {
	const boxes = [];
	const deps = {
		pick: () => null, ground: () => null, focus() {}, setInputEnabled() {}, publish() {},
		fixedFrame: () => "map", now: () => 0, requestRender() {},
		inspect: (x, y) => ({ point: { x, y, z: 0 }, lines: ["clicked"] }),
		boxSelect: (rect) => {
			boxes.push(rect);
			const e = new SelectionEntry("d", "D", "Display");
			e.addPoint(boxes.length, 0, 0, 0);
			return new Map([["d", e]]);
		},
	};
	const tools = new ToolManager(deps);
	const changes = [];
	tools.onSelection = (s) => changes.push(s);
	tools.select("select");
	const press = (kind, x, y, extra = {}) => tools.pointer(kind, { clientX: x, clientY: y, button: 0, ...extra });
	press("down", 10, 10);
	press("up", 11, 10);
	assert.deepEqual(tools.selection.lines, ["clicked"]);
	press("down", 100, 100);
	press("move", 40, 60);
	assert.deepEqual(tools.selectBox, { left: 40, top: 60, right: 100, bottom: 100 });
	press("up", 40, 60);
	assert.equal(tools.selectBox, null);
	assert.deepEqual(boxes[0], { left: 40, top: 60, right: 100, bottom: 100 });
	assert.equal(tools.selection.entries.get("d").points, 1);
	press("down", 0, 0);
	press("up", 30, 30, { shiftKey: true });
	assert.equal(tools.selection.entries.get("d").points, 2);
	assert.equal(changes.length, 3);
	tools.clearSelection();
	assert.equal(tools.selection, null);
	assert.equal(changes.at(-1), null);
});
