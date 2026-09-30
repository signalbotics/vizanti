import test from 'node:test';
import assert from 'node:assert/strict';
import { depthToPoints } from '../../public/js/geometry/depth.js';
import { sensorReading, SENSOR_TYPES } from '../../public/js/geometry/sensors.js';
import { DepthCloudDisplay } from '../../public/js/displays/depthcloud.js';
import { SensorValueDisplay } from '../../public/js/displays/sensorvalue.js';
import { defaultsOf } from '../../public/js/core/properties.js';

const info = { width: 2, height: 2, k: [1, 0, 1, 0, 1, 1, 0, 0, 1] };
const near = (a, b) => Math.abs(a - b) < 1e-6;

function depth16(values, width, height) {
	const bytes = new Uint8Array(values.length * 2);
	new DataView(bytes.buffer).setUint16(0, 0, true);
	values.forEach((v, i) => new DataView(bytes.buffer).setUint16(i * 2, v, true));
	return { encoding: "16UC1", width, height, step: width * 2, is_bigendian: 0, data: bytes };
}

test('depthToPoints unprojects 16-bit millimetre depth through the intrinsics', () => {
	const r = depthToPoints(depth16([1000, 0, 2000, 500], 2, 2), info, { stride: 1, maxDepth: 10 });
	// pixel (0,0) at 1 m: x = (0 - 1) / 1 * 1 = -1, y = -1, z = 1; the zero pixel is skipped
	assert.equal(r.count, 3);
	assert.deepEqual([...r.positions.slice(0, 3)], [-1, -1, 1]);
	assert.deepEqual([...r.positions.slice(3, 6)], [-2, 0, 2]); // pixel (0,1) at 2 m
	assert.ok(near(r.positions[6], 0) && near(r.positions[7], 0) && near(r.positions[8], 0.5)); // pixel (1,1)
});

test('depthToPoints reads 32-bit float metres, skips NaN and anything beyond the range', () => {
	const f = new Float32Array([1.5, NaN, 20, 3]);
	const r = depthToPoints({ encoding: "32FC1", width: 2, height: 2, step: 8, is_bigendian: 0, data: new Uint8Array(f.buffer) }, info, { stride: 1, maxDepth: 10 });
	assert.equal(r.count, 2);
	assert.ok(near(r.positions[2], 1.5) && near(r.positions[5], 3));
});

test('depthToPoints thins by stride and reports what it cannot read', () => {
	const values = new Array(16).fill(1000);
	const r = depthToPoints(depth16(values, 4, 4), { width: 4, height: 4, k: [1, 0, 0, 0, 1, 0, 0, 0, 1] }, { stride: 2, maxDepth: 10 });
	assert.equal(r.count, 4);
	assert.match(depthToPoints({ encoding: "rgb8", width: 1, height: 1, step: 3, data: new Uint8Array(3) }, info, { stride: 1, maxDepth: 10 }).error, /not a depth encoding/);
	assert.match(depthToPoints(depth16([1], 1, 1), { width: 0, height: 0, k: [] }, { stride: 1, maxDepth: 10 }).error, /CameraInfo/);
});

test('sensorReading picks the value, unit and a readable label for each sensor type', () => {
	assert.deepEqual(sensorReading({ temperature: 21.456 }, SENSOR_TYPES.temperature), { value: 21.456, text: "21.46 °C" });
	assert.deepEqual(sensorReading({ fluid_pressure: 101325 }, SENSOR_TYPES.pressure), { value: 101325, text: "101325.00 Pa" });
	assert.deepEqual(sensorReading({ illuminance: 300 }, SENSOR_TYPES.illuminance), { value: 300, text: "300.00 lx" });
	assert.deepEqual(sensorReading({ relative_humidity: 0.45 }, SENSOR_TYPES.humidity), { value: 0.45, text: "45.0 %" });
	assert.equal(sensorReading({}, SENSOR_TYPES.temperature), null);
});

test('display options', () => {
	assert.equal(DepthCloudDisplay.type, "depthcloud");
	assert.deepEqual(defaultsOf(DepthCloudDisplay.properties), { topic: "", info_topic: "", stride: 2, max_depth: 10, thickness: 0.01, color: "#29b6f6", opacity: 1, throttle: 200 });
	assert.equal(DepthCloudDisplay.propsForTopic("/cam/depth/image_raw").info_topic, "/cam/depth/camera_info");
	assert.equal(SensorValueDisplay.type, "sensorvalue");
	assert.deepEqual(SensorValueDisplay.msgTypes, Object.values(SENSOR_TYPES));
	assert.deepEqual(defaultsOf(SensorValueDisplay.properties), { topic: "", topic_type: "", color: "#ffffff", size: 16, throttle: 200 });
});
