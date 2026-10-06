import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCloud } from '../../public/js/geometry/pointcloud.js';
import { PointCloudDisplay } from '../../public/js/displays/pointcloud.js';
import { defaultsOf } from '../../public/js/core/properties.js';

// builds a PointCloud2 with float32 x,y,z and optionally a packed rgb field
function cloud(points, { rgb = false, encode = "bytes", bigendian = false } = {}) {
	const step = rgb ? 16 : 12;
	const buffer = new ArrayBuffer(points.length * step);
	const view = new DataView(buffer);
	points.forEach((p, i) => {
		view.setFloat32(i * step, p[0], !bigendian);
		view.setFloat32(i * step + 4, p[1], !bigendian);
		view.setFloat32(i * step + 8, p[2], !bigendian);
		if (rgb) view.setUint32(i * step + 12, p[3], !bigendian);
	});
	const bytes = new Uint8Array(buffer);
	const fields = [
		{ name: "x", offset: 0, datatype: 7, count: 1 },
		{ name: "y", offset: 4, datatype: 7, count: 1 },
		{ name: "z", offset: 8, datatype: 7, count: 1 },
	];
	if (rgb) fields.push({ name: "rgb", offset: 12, datatype: 7, count: 1 });
	let data = bytes;
	if (encode === "base64") data = Buffer.from(bytes).toString("base64");
	if (encode === "array") data = [...bytes];
	if (encode === "buffer") data = buffer;
	return { width: points.length, height: 1, point_step: step, is_bigendian: bigendian, fields, data };
}

test('decodes xyz from every transport encoding', () => {
	for (const encode of ["bytes", "base64", "array", "buffer"]) {
		const r = decodeCloud(cloud([[1, 2, 3], [4, 5, 6]], { encode }), 100);
		assert.equal(r.count, 2, encode);
		assert.deepEqual([...r.positions], [1, 2, 3, 4, 5, 6], encode);
		assert.equal(r.colors, null);
	}
});

test('decodes packed rgb into 0..1 colours', () => {
	const r = decodeCloud(cloud([[0, 0, 0, 0xff8000]], { rgb: true }), 100);
	assert.deepEqual([...r.colors].map((v) => +v.toFixed(3)), [1, 0.502, 0]);
});

test('honours big-endian clouds', () => {
	assert.deepEqual([...decodeCloud(cloud([[1, 2, 3]], { bigendian: true }), 100).positions], [1, 2, 3]);
});

test('thins clouds above the point limit', () => {
	const pts = Array.from({ length: 100 }, (_, i) => [i, 0, 0]);
	const r = decodeCloud(cloud(pts), 10);
	assert.equal(r.count, 10);
	assert.equal(r.stride, 10);
	assert.equal(r.positions[3], 10);
});

test('skips points that are not finite', () => {
	const r = decodeCloud(cloud([[NaN, 0, 0], [1, Infinity, 0], [7, 8, 9]]), 100);
	assert.equal(r.count, 1);
	assert.deepEqual([...r.positions], [7, 8, 9]);
});

test('reports clouds it cannot read instead of throwing', () => {
	const noXyz = cloud([[1, 2, 3]]);
	noXyz.fields = noXyz.fields.slice(0, 2);
	assert.match(decodeCloud(noXyz, 100).error, /XYZ coordinate data not found/);

	const short = cloud([[1, 2, 3], [4, 5, 6]]);
	short.data = short.data.slice(0, 12);
	assert.match(decodeCloud(short, 100).error, /smaller than/);

	const odd = cloud([[1, 2, 3]]);
	odd.data = 42;
	assert.match(decodeCloud(odd, 100).error, /unknown data type/);

	assert.equal(decodeCloud(cloud([]), 100).count, 0);
});

test('PointCloudDisplay keeps the options of the widget it replaces', () => {
	assert.equal(PointCloudDisplay.type, "pointcloud");
	assert.deepEqual(PointCloudDisplay.msgTypes, ["sensor_msgs/msg/PointCloud2"]);
	assert.deepEqual(defaultsOf(PointCloudDisplay.properties), {
		topic: "", style: "squares", thickness: 0.02, pixel_size: 3, max_points: 15000, opacity: 1, decay_ms: 0,
		colour_mode: "rgb", channel: "intensity", color: "#1f8eec", colour_override: false, throttle: 1000,
	});
});

import { rainbow, colorizeValues, axisValues } from '../../public/js/geometry/pointcloud.js';

// x,y,z float32 plus an intensity float32 at offset 12
function intensityCloud(points) {
	const step = 16;
	const buffer = new ArrayBuffer(points.length * step);
	const view = new DataView(buffer);
	points.forEach((p, i) => p.forEach((v, k) => view.setFloat32(i * step + k * 4, v, true)));
	return {
		width: points.length, height: 1, point_step: step, is_bigendian: false, data: new Uint8Array(buffer),
		fields: [
			{ name: "x", offset: 0, datatype: 7, count: 1 },
			{ name: "y", offset: 4, datatype: 7, count: 1 },
			{ name: "z", offset: 8, datatype: 7, count: 1 },
			{ name: "intensity", offset: 12, datatype: 7, count: 1 },
		],
	};
}

test('decodeCloud reads a named scalar channel per kept point, with its range', () => {
	const r = decodeCloud(intensityCloud([[0, 0, 0, 5], [1, 0, 0, NaN], [NaN, 0, 0, 99], [2, 0, 0, 25]]), 100, { channel: "intensity" });
	// the point with NaN coordinates is dropped; a NaN channel value is kept but left out of the range
	assert.equal(r.count, 3);
	assert.deepEqual(Array.from(r.values), [5, NaN, 25]);
	assert.deepEqual(r.range, { min: 5, max: 25 });
	const missing = decodeCloud(intensityCloud([[0, 0, 0, 1]]), 100, { channel: "reflectivity" });
	assert.equal(missing.values, null);
});

test('rainbow runs from blue at the low end to red at the high end', () => {
	assert.deepEqual(rainbow(0).map((v) => Math.round(v * 100) / 100), [0, 0, 1]);
	assert.deepEqual(rainbow(1).map((v) => Math.round(v * 100) / 100), [1, 0, 0]);
	const mid = rainbow(0.5);
	assert.ok(mid[1] > 0.9, "the middle is green");
	assert.deepEqual(rainbow(-3), rainbow(0));
	assert.deepEqual(rainbow(7), rainbow(1));
});

test('colorizeValues maps values over a range to rainbow RGB, and a flat range to the middle', () => {
	const c = colorizeValues(new Float32Array([0, 10]), 0, 10);
	assert.equal(c.length, 6);
	assert.deepEqual(Array.from(c.slice(0, 3)).map(Math.round), [0, 0, 1]);
	assert.deepEqual(Array.from(c.slice(3, 6)).map(Math.round), [1, 0, 0]);
	const flat = colorizeValues(new Float32Array([4, 4]), 4, 4);
	assert.deepEqual(Array.from(flat.slice(0, 3)), rainbow(0.5));
});

test('axisValues gives each point\'s coordinate along an axis after a transform', () => {
	// translation by (0, 0, 2) as a column-major 4x4
	const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 2, 1];
	const positions = new Float32Array([1, 2, 3, -1, 0, -2]);
	assert.deepEqual(Array.from(axisValues(positions, m, "z")), [5, 0]);
	assert.deepEqual(Array.from(axisValues(positions, m, "x")), [1, -1]);
	// a 90 degree turn about z maps x onto y
	const rz = [0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
	assert.deepEqual(Array.from(axisValues(new Float32Array([1, 0, 0]), rz, "y")).map(Math.round), [1]);
});
