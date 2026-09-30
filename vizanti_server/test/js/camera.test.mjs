import test from 'node:test';
import assert from 'node:assert/strict';
import { frustumCorners, cameraInfoValid } from '../../public/js/geometry/camera.js';
import { CameraDisplay } from '../../public/js/displays/camera.js';
import { defaultsOf } from '../../public/js/core/properties.js';

const info = { width: 640, height: 480, k: [500, 0, 320, 0, 500, 240, 0, 0, 1] };
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('frustum corners follow the intrinsics, in the optical frame (z forward, x right, y down)', () => {
	const c = frustumCorners(info, 2);
	// top-left pixel (0, 0): x = (0 - 320) / 500 * 2, y = (0 - 240) / 500 * 2
	assert.ok(near(c.topLeft.x, -1.28) && near(c.topLeft.y, -0.96) && near(c.topLeft.z, 2));
	assert.ok(near(c.bottomRight.x, 1.28) && near(c.bottomRight.y, 0.96));
	assert.ok(near(c.topRight.x, 1.28) && near(c.bottomLeft.y, 0.96));
});

test('an off-centre principal point shifts the frustum', () => {
	const c = frustumCorners({ ...info, k: [500, 0, 0, 0, 500, 0, 0, 0, 1] }, 1);
	assert.ok(near(c.topLeft.x, 0) && near(c.topLeft.y, 0));
	assert.ok(near(c.bottomRight.x, 1.28) && near(c.bottomRight.y, 0.96));
});

test('camera info without usable intrinsics is rejected', () => {
	assert.equal(cameraInfoValid(info), true);
	assert.equal(cameraInfoValid({ ...info, k: [0, 0, 320, 0, 500, 240, 0, 0, 1] }), false);
	assert.equal(cameraInfoValid({ ...info, width: 0 }), false);
	assert.equal(cameraInfoValid({ ...info, k: [500, 0] }), false);
	assert.equal(cameraInfoValid(null), false);
	// ROS 1 style upper-case K is accepted too
	assert.equal(cameraInfoValid({ width: 640, height: 480, K: info.k }), true);
});

test('CameraDisplay options', () => {
	assert.equal(CameraDisplay.type, "camera");
	assert.deepEqual(CameraDisplay.msgTypes, ["sensor_msgs/msg/Image", "sensor_msgs/msg/CompressedImage"]);
	assert.deepEqual(defaultsOf(CameraDisplay.properties), {
		topic: "", topic_type: "", info_topic: "", distance: 1, opacity: 0.8, show_frustum: true, show_overlay: false, throttle: 200,
	});
	assert.equal(CameraDisplay.propsForTopic("/cam/image_raw", "sensor_msgs/msg/Image").info_topic, "/cam/camera_info");
	assert.equal(CameraDisplay.propsForTopic("/cam/image_raw/compressed", "sensor_msgs/msg/CompressedImage").info_topic, "/cam/camera_info");
});
