import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeStatus, renderRate } from '../../public/js/core/status_summary.js';

const item = (id, name, level, text = "", enabled = true) => ({ id, name, enabled, status: { level, text } });

test('connection: ok when connected, error otherwise, with rosbridge\'s own words', () => {
	assert.deepEqual(summarizeStatus({ connected: true, status: "Connected.", url: "robot:9090" }, "map", new Set(["map"]), []).connection,
		{ level: "ok", text: "Connected to robot:9090" });
	assert.deepEqual(summarizeStatus({ connected: false, status: "Connection lost.", url: "robot:9090" }, "map", new Set(), []).connection,
		{ level: "error", text: "Connection lost." });
});

test('fixed frame: warns without TF, errors when the frame is unknown, ok when present', () => {
	const ros = { connected: true, status: "", url: "" };
	assert.equal(summarizeStatus(ros, "map", new Set(), []).frame.level, "warn");
	const missing = summarizeStatus(ros, "odom", new Set(["map", "base_link"]), []).frame;
	assert.equal(missing.level, "error");
	assert.match(missing.text, /odom/);
	assert.deepEqual(summarizeStatus(ros, "map", new Set(["map", "base_link"]), []).frame, { level: "ok", text: "Fixed frame: map" });
	assert.equal(summarizeStatus(ros, "", new Set(["map"]), []).frame.level, "error");
});

test('displays: counts warnings and errors of enabled displays and points at the worst first', () => {
	const items = [
		item("a", "Grid", "ok"),
		item("b", "Map", "warn", "No data received."),
		item("c", "Scan", "error", "No transform"),
		item("d", "Off", "error", "ignored", false),
		item("e", "Cloud", "warn", "slow"),
	];
	const { displays } = summarizeStatus({ connected: true, status: "", url: "" }, "map", new Set(["map"]), items);
	assert.equal(displays.errors, 1);
	assert.equal(displays.warnings, 2);
	assert.equal(displays.level, "error");
	assert.equal(displays.firstProblemId, "c");
	assert.equal(displays.text, "1 error, 2 warnings");
	const clean = summarizeStatus({ connected: true, status: "", url: "" }, "map", new Set(["map"]), [item("a", "Grid", "ok")]).displays;
	assert.deepEqual(clean, { level: "ok", text: "All displays OK", errors: 0, warnings: 0, firstProblemId: null });
});

test('renderRate turns frame counts over an interval into frames per second', () => {
	assert.equal(renderRate(30, 1000), 30);
	assert.equal(renderRate(15, 500), 30);
	assert.equal(renderRate(0, 1000), 0);
	assert.equal(renderRate(5, 0), 0);
});
