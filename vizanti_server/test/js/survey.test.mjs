import test from 'node:test';
import assert from 'node:assert/strict';
import { insertIndexClosed, transectExtent, countTransects, autoSpacing, fromLegacySurvey } from '../../public/js/geometry/survey.js';

const P = (x, y, z = 0) => ({ x, y, z });
const square = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];

test('a click near an edge of the polygon, the closing edge included, inserts there', () => {
	assert.equal(insertIndexClosed(square, P(5, 0.2), 0.5), 1);
	assert.equal(insertIndexClosed(square, P(0.2, 5), 0.5), 4, "on the closing edge: after the last vertex");
	assert.equal(insertIndexClosed(square, P(5, 5), 0.5), 4, "inside: appended");
	assert.equal(insertIndexClosed([P(0, 0)], P(1, 1), 0.5), 1);
});

test('transect extent and line count follow the old widget', () => {
	assert.equal(transectExtent(square, 0), 10);
	assert.ok(Math.abs(transectExtent(square, Math.PI / 4) - 10 * Math.SQRT2) < 1e-9);
	assert.equal(countTransects(square, 0, 1), 10);
	assert.equal(countTransects(square, 0, 4), 2, "ceil((10 - 2) / 4), the old formula");
	assert.equal(countTransects([P(0, 0), P(1, 0)], 0, 1), 0);
});

test('autoSpacing aims for about ten lines when the count is outside 5..30', () => {
	assert.equal(autoSpacing(square, 0, 1, false), 1, "10 lines: kept");
	assert.equal(autoSpacing(square, 0, 0.1, false), 1, "100 lines: resized to 10");
	assert.equal(autoSpacing(square, 0, 5, false), 1, "2 lines: resized to 10");
	const big = [P(0, 0), P(1000, 0), P(1000, 1000), P(0, 1000)];
	assert.equal(autoSpacing(big, 0, 1, false), 100);
	assert.equal(autoSpacing(square, 0, 0.6, true), 1, "criss-cross counts both directions");
});

test('fromLegacySurvey carries over an old widget survey', () => {
	const props = fromLegacySurvey({
		topic: "/survey", topic_type: "nav_msgs/msg/Path", fixed_frame: "map", base_link_frame: "base_link",
		polygon: [{ x: 0, y: 0 }, { x: 5, y: 0, z: 1 }, { x: 5, y: 5 }], start_marker: { x: -1, y: 0 }, end_marker: { x: 6, y: 5 },
		spacing: "2", angle: "30", turnaround: "1.5", crosshatch: true, direct_transit: false,
	});
	assert.deepEqual(props, {
		mission_topic: "/survey", message_type: "nav_msgs/msg/Path", frame: "map", robot_frame: "base_link",
		polygon: [P(0, 0), P(5, 0, 1), P(5, 5)], markers: [P(-1, 0), P(6, 5)],
		spacing: 2, angle: 30, turnaround: 1.5, crosshatch: true, direct_transit: false,
	});
	assert.deepEqual(fromLegacySurvey({}).polygon, []);
	assert.deepEqual(fromLegacySurvey({}).markers, []);
});
