import test from 'node:test';
import assert from 'node:assert/strict';
import { mapToRGBA, COLOUR_SCHEMES } from '../../public/js/geometry/map.js';
import { MapDisplay } from '../../public/js/displays/map.js';
import { defaultsOf, enumValues, flattenSchema } from '../../public/js/core/properties.js';

const px = (r, i) => [...r.rgba.slice(i * 4, i * 4 + 4)];

test('the six colour schemes of the current map widget exist', () => {
	assert.deepEqual(COLOUR_SCHEMES, ["map", "costmap", "raw", "raw_transparent", "raw_transparent_black", "sonar"]);
});

test('map scheme: free is white, occupied is black, unknown is faint green', () => {
	const r = mapToRGBA([0, 100, 50, -1], 2, 2, "map");
	assert.deepEqual([r.width, r.height, r.factor], [2, 2, 1]);
	assert.deepEqual(px(r, 0), [255, 255, 255, 255]);
	assert.deepEqual(px(r, 1), [0, 0, 0, 255]);
	assert.deepEqual(px(r, 2), [127, 127, 127, 255]);
	assert.deepEqual(px(r, 3), [0, 255, 0, 30]);
});

test('costmap scheme: zero is transparent, 99 cyan, 100 purple, -1 faint grey-green', () => {
	const r = mapToRGBA([0, 99, 100, -1, 50], 5, 1, "costmap");
	assert.deepEqual(px(r, 0), [0, 0, 0, 0]);
	assert.deepEqual(px(r, 1), [0, 255, 255, 255]);
	assert.deepEqual(px(r, 2), [255, 0, 255, 255]);
	assert.deepEqual(px(r, 3), [0x70, 0x89, 0x86, 15]);
	assert.deepEqual(px(r, 4), [127, 0, 127, 255]);
});

test('raw schemes map the byte value to grey, with the documented alpha', () => {
	assert.deepEqual(px(mapToRGBA([200], 1, 1, "raw"), 0), [200, 200, 200, 255]);
	assert.deepEqual(px(mapToRGBA([-1], 1, 1, "raw"), 0), [255, 255, 255, 255]);
	assert.deepEqual(px(mapToRGBA([255], 1, 1, "raw_transparent"), 0), [255, 255, 255, 0]);
	assert.deepEqual(px(mapToRGBA([0], 1, 1, "raw_transparent"), 0), [0, 0, 0, 255]);
	assert.deepEqual(px(mapToRGBA([0], 1, 1, "raw_transparent_black"), 0), [0, 0, 0, 0]);
});

test('sonar scheme is a false-colour ramp that fades in below 10', () => {
	assert.deepEqual(px(mapToRGBA([0], 1, 1, "sonar"), 0), [0, 0, 0, 0]);
	assert.deepEqual(px(mapToRGBA([255], 1, 1, "sonar"), 0), [255, 255, 255, 255]);
	assert.equal(px(mapToRGBA([5], 1, 1, "sonar"), 0)[3], 128);
});

test('an unknown scheme falls back to raw', () => {
	assert.deepEqual(px(mapToRGBA([40], 1, 1, "nope"), 0), [40, 40, 40, 255]);
});

test('data that does not match width x height is an error, not garbage', () => {
	const r = mapToRGBA([0, 0, 0], 2, 2, "map");
	assert.equal(r.rgba, undefined);
	assert.match(r.error, /3 cells.*2x2/);
});

test('non-numeric cells are treated as zero and out-of-range cells are clamped', () => {
	const r = mapToRGBA([null, 999, -999], 3, 1, "raw");
	assert.deepEqual(px(r, 0), [0, 0, 0, 255]);
	assert.deepEqual(px(r, 1), [255, 255, 255, 255]);
	assert.deepEqual(px(r, 2), [0, 0, 0, 255]);
});

test('maps larger than the texture limit are reduced by a whole factor', () => {
	const data = new Array(8 * 4).fill(0);
	data[0] = 100;
	data[2] = 100;
	const r = mapToRGBA(data, 8, 4, "map", 4);
	assert.deepEqual([r.width, r.height, r.factor], [4, 2, 2]);
	assert.equal(r.rgba.length, 4 * 2 * 4);
	assert.deepEqual(px(r, 0), [0, 0, 0, 255]);
	assert.deepEqual(px(r, 1), [0, 0, 0, 255]);
	assert.deepEqual(px(r, 2), [255, 255, 255, 255]);
});

test('typed arrays are accepted', () => {
	assert.deepEqual(px(mapToRGBA(new Int8Array([100]), 1, 1, "map"), 0), [0, 0, 0, 255]);
});

test('MapDisplay declares every option the current map widget has', () => {
	assert.equal(MapDisplay.type, "map");
	assert.deepEqual(MapDisplay.msgTypes, ["nav_msgs/msg/OccupancyGrid"]);
	assert.deepEqual(defaultsOf(MapDisplay.properties), {
		topic: "", colour_scheme: "map", use_timestamp: false, opacity: 0.7, throttle: 1000,
	});
	assert.deepEqual(enumValues(flattenSchema(MapDisplay.properties).colour_scheme), COLOUR_SCHEMES);
});

test('a costmap topic starts with the costmap colour scheme', () => {
	assert.deepEqual(MapDisplay.propsForTopic("/local_costmap/costmap"), { topic: "/local_costmap/costmap", colour_scheme: "costmap" });
	assert.deepEqual(MapDisplay.propsForTopic("/map"), { topic: "/map", colour_scheme: "map" });
});
