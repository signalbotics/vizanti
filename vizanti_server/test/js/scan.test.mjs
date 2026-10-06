import test from 'node:test';
import assert from 'node:assert/strict';
import { scanPoints, radToDeg } from '../../public/js/geometry/scan.js';
import { ScanDisplay } from '../../public/js/displays/scan.js';
import { defaultsOf } from '../../public/js/core/properties.js';

const scan = (ranges, extra = {}) => ({
	angle_min: 0, angle_increment: Math.PI / 2, range_min: 0.1, range_max: 10, ranges, ...extra,
});
const near = (a, b) => Math.abs(a - b) < 1e-6;

test('ranges become points in the sensor frame', () => {
	const r = scanPoints(scan([1, 2, 3]));
	assert.equal(r.count, 3);
	assert.equal(r.stride, 1);
	assert.equal(r.positions.length, 9);
	assert.ok(near(r.positions[0], 1) && near(r.positions[1], 0));
	assert.ok(near(r.positions[3], 0) && near(r.positions[4], 2));
	assert.ok(near(r.positions[6], -3) && near(r.positions[7], 0));
	assert.equal(r.positions[2], 0);
});

test('ranges outside the sensor limits are dropped', () => {
	const r = scanPoints(scan([0.05, 1, 11]));
	assert.equal(r.count, 1);
	assert.ok(near(r.positions[1], 1));
});

test('NaN, infinite and null ranges are dropped, even with open limits', () => {
	const msg = scan([NaN, Infinity, -Infinity, null, undefined, "2", 4], { range_min: 0, range_max: Infinity });
	const r = scanPoints(msg);
	assert.equal(r.count, 1);
	assert.ok([...r.positions].every(Number.isFinite));
});

test('an empty scan gives no points', () => {
	const r = scanPoints(scan([]));
	assert.deepEqual([r.count, r.positions.length, r.stride], [0, 0, 1]);
});

test('scans over the budget are thinned evenly and keep their angles', () => {
	const ranges = new Array(100).fill(1);
	const r = scanPoints(scan(ranges, { angle_increment: 0.01 }), 25);
	assert.equal(r.stride, 4);
	assert.equal(r.count, 25);
	// second kept point is ray 4, at angle 0.04
	assert.ok(near(r.positions[3], Math.cos(0.04)) && near(r.positions[4], Math.sin(0.04)));
});

test('radToDeg formats to two decimals', () => {
	assert.equal(radToDeg(Math.PI), "180.00");
});

test('ScanDisplay declares every option the current scan widget has', () => {
	assert.equal(ScanDisplay.type, "scan");
	assert.deepEqual(ScanDisplay.msgTypes, ["sensor_msgs/msg/LaserScan"]);
	assert.deepEqual(defaultsOf(ScanDisplay.properties), {
		topic: "", opacity: 1, thickness: 0.02, color: "#ff0000", colour_mode: "flat", decay_ms: 0, throttle: 2000,
	});
});

test('scanPoints also returns the intensity and range of each kept ray', () => {
	const msg = { angle_min: 0, angle_increment: Math.PI / 2, range_min: 0.1, range_max: 10,
		ranges: [1, null, 2, 50], intensities: [10, 20, 30, 40] };
	const r = scanPoints(msg);
	assert.equal(r.count, 2);
	assert.deepEqual(Array.from(r.intensities), [10, 30]);
	assert.deepEqual(Array.from(r.ranges), [1, 2]);
	const none = scanPoints({ ...msg, intensities: [] });
	assert.equal(none.intensities, null);
});
