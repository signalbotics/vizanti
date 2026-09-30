import test from 'node:test';
import assert from 'node:assert/strict';
import { zoomForScale, tileList, parentCrop, tileUrl, wrapTileX } from '../../public/js/geometry/tiles.js';
import { SatelliteDisplay } from '../../public/js/displays/satelite.js';
import { defaultsOf } from '../../public/js/core/properties.js';

test('zoomForScale follows the view scale and stays within what tile servers offer', () => {
	assert.equal(zoomForScale(1), 17);
	assert.equal(zoomForScale(4), 19);
	assert.equal(zoomForScale(1000), 19);
	assert.equal(zoomForScale(0.00001), 7);
	assert.equal(zoomForScale(NaN), 17);
});

test('tileList covers the range from the centre outwards', () => {
	const list = tileList(10, 12, 20, 21, 100);
	assert.equal(list.length, 6);
	assert.equal(list[0].x, 11); // the middle column comes first
	assert.deepEqual(new Set(list.map((t) => `${t.x},${t.y}`)).size, 6);
});

test('tileList refuses ranges larger than the tile budget', () => {
	assert.equal(tileList(0, 99, 0, 99, 200), null);
	assert.equal(tileList(5, 4, 0, 0, 200).length, 0);
});

test('parentCrop finds the part of an ancestor tile that covers a tile', () => {
	// tile (5, 3) at one level up is the lower-right quarter of tile (2, 1)
	assert.deepEqual(parentCrop(5, 3, 1), { x: 2, y: 1, u0: 0.5, v0: 0.5, size: 0.5 });
	assert.deepEqual(parentCrop(4, 2, 2), { x: 1, y: 0, u0: 0, v0: 0.5, size: 0.25 });
});

test('tileUrl fills the template and wrapTileX wraps across the antimeridian', () => {
	assert.equal(tileUrl("https://t/{z}/{x}/{y}.png", 3, 4, 5), "https://t/3/4/5.png");
	assert.equal(wrapTileX(-1, 3), 7);
	assert.equal(wrapTileX(8, 3), 0);
	assert.equal(wrapTileX(5, 3), 5);
});

test('SatelliteDisplay keeps the options of the widget it replaces', () => {
	assert.equal(SatelliteDisplay.type, "satelite");
	assert.deepEqual(SatelliteDisplay.msgTypes, ["sensor_msgs/msg/NavSatFix"]);
	assert.deepEqual(defaultsOf(SatelliteDisplay.properties), {
		topic: "", server_url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", smoothing: true, ignore_rotation: true, opacity: 0.7,
	});
});
