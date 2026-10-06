import test from 'node:test';
import assert from 'node:assert/strict';
import { imuSummary } from '../../public/js/geometry/imu.js';
import { ImuDisplay } from '../../public/js/displays/imu.js';

const imu = (q, a, w, cov0 = 0) => ({
	orientation: q, orientation_covariance: [cov0, 0, 0, 0, 0, 0, 0, 0, 0],
	linear_acceleration: a, angular_velocity: w,
});

test('imuSummary turns the orientation into roll, pitch and yaw in degrees', () => {
	const yaw90 = { x: 0, y: 0, z: Math.SQRT1_2, w: Math.SQRT1_2 };
	const s = imuSummary(imu(yaw90, { x: 0, y: 0, z: 9.81 }, { x: 0, y: 0, z: 0.5 }));
	assert.equal(s.hasOrientation, true);
	assert.deepEqual(s.rpyDeg.map((v) => Math.round(v)), [0, 0, 90]);
	assert.ok(Math.abs(s.accelNorm - 9.81) < 1e-9);
	assert.ok(Math.abs(s.gyroNorm - 0.5) < 1e-9);
	const roll30 = { x: Math.sin(Math.PI / 12), y: 0, z: 0, w: Math.cos(Math.PI / 12) };
	assert.deepEqual(imuSummary(imu(roll30, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 })).rpyDeg.map((v) => Math.round(v)), [30, 0, 0]);
});

test('an orientation covariance of -1 means the IMU gives no orientation', () => {
	const s = imuSummary(imu({ x: 0, y: 0, z: 0, w: 1 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, -1));
	assert.equal(s.hasOrientation, false);
	assert.equal(s.rpyDeg, null);
});

test('an all-zero quaternion is treated as no orientation rather than a crash', () => {
	const s = imuSummary(imu({ x: 0, y: 0, z: 0, w: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }));
	assert.equal(s.hasOrientation, false);
});

test('the IMU display subscribes to sensor_msgs/Imu', () => {
	assert.deepEqual(ImuDisplay.msgTypes, ["sensor_msgs/msg/Imu"]);
	assert.equal(ImuDisplay.type, "imu");
});
