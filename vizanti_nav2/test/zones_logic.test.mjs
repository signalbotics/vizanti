import test from 'node:test';
import assert from 'node:assert/strict';
import { filterKind, maskValue, valueText, gridFrom, rasterize, maskMessage, toPgm, toYaml, fileName, fingerprint } from '../vizanti/zones_logic.js';

const keepout = { type: 0, filter_mask_topic: '/keepout_filter_mask', base: 0, multiplier: 1 };
const speedPercent = { type: 1, filter_mask_topic: '/speed_filter_mask', base: 100, multiplier: -1 }; // Nav2's tutorial
const speedAbsolute = { type: 2, filter_mask_topic: '/speed_mask', base: 0, multiplier: 0.01 };

test('mask values: keepout is 100; a speed limit is (limit - base) / multiplier', () => {
	assert.equal(filterKind(keepout).key, 'keepout');
	assert.deepEqual(maskValue(keepout, ''), { value: 100 });
	assert.deepEqual(maskValue(speedPercent, '40'), { value: 60 }); // 100 - 60 = 40 %
	assert.equal(valueText(speedPercent, 60), '40 %');
	assert.deepEqual(maskValue(speedAbsolute, '0.25'), { value: 25 });
	assert.equal(valueText(speedAbsolute, 25), '0.25 m/s');
	assert.match(maskValue(speedPercent, '').error, /speed limit in %/);
	assert.match(maskValue(speedPercent, '100').error, /can limit to 0 … 99 %/); // 0 would be "no limit"
	assert.match(maskValue({ type: 9 }, '1').error, /Unknown filter type/);
});

test('zones are filled into the grid by cell centre; later zones win; the current mask kept or not', () => {
	// 10 x 10 cells of 0.1 m from (-0.5, -0.5)
	const msg = { header: { frame_id: 'map' }, info: { width: 10, height: 10, resolution: 0.1, origin: { position: { x: -0.5, y: -0.5, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }, data: new Array(100).fill(0) };
	msg.data[99] = 30; // a zone already in the mask (top right cell)
	const grid = gridFrom(msg);
	const square = { points: [{ x: -0.3, y: -0.3 }, { x: 0.1, y: -0.3 }, { x: 0.1, y: 0.1 }, { x: -0.3, y: 0.1 }], value: 100 };
	const data = rasterize(grid, [square]);
	const cell = (x, y) => data[Math.floor((y + 0.5) / 0.1) * 10 + Math.floor((x + 0.5) / 0.1)];
	assert.equal(cell(-0.25, -0.25), 100);
	assert.equal(cell(0.05, 0.05), 100);
	assert.equal(cell(0.15, 0.05), 0);
	assert.equal(data.filter((v) => v === 100).length, 16); // 4 x 4 cells
	assert.equal(data[99], 30, 'the zone already in the mask is kept');
	assert.equal(rasterize(grid, [square], false)[99], 0, 'or not');
	const slow = { points: [{ x: -0.3, y: -0.3 }, { x: -0.1, y: -0.3 }, { x: -0.1, y: -0.1 }], value: 60 };
	assert.equal(rasterize(grid, [square, slow])[2 * 10 + 2], 60, 'a later zone wins');
	assert.equal(rasterize(grid, [{ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], value: 100 }]).filter((v) => v).length, 1, 'fewer than 3 points: no zone');
	const out = maskMessage(grid, data, { sec: 5, nanosec: 0 });
	assert.equal(out.info.width, 10);
	assert.equal(out.data.length, 100);
	assert.equal(out.header.frame_id, 'map');
});

test('saved as map_server reads a raw mask: PGM top row first, unknown 255', () => {
	const grid = { width: 2, height: 2, resolution: 0.05, origin: { x: -10, y: -10 }, yaw: 0, frame: 'map' };
	const data = Int8Array.from([0, 100, -1, 60]); // row 0 (bottom): 0 100; row 1 (top): -1 60
	const pgm = toPgm(grid, data);
	const text = new TextDecoder().decode(pgm.slice(0, pgm.length - 4));
	assert.match(text, /^P5\n# Vizanti costmap zones\n2 2\n255\n$/);
	assert.deepEqual([...pgm.slice(-4)], [255, 60, 0, 100]);
	assert.equal(toYaml('keepout_filter_mask', grid), 'image: keepout_filter_mask.pgm\nmode: raw\nresolution: 0.05\norigin: [-10, -10, 0]\nnegate: 0\noccupied_thresh: 0.65\nfree_thresh: 0.25\n');
	assert.equal(fileName('/robot1/keepout_filter_mask'), 'robot1_keepout_filter_mask');
	assert.equal(fingerprint(data), fingerprint(Int8Array.from([0, 100, -1, 60])));
	assert.notEqual(fingerprint(data), fingerprint(Int8Array.from([0, 100, -1, 61])));
});
