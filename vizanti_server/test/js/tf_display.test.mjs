import test from 'node:test';
import assert from 'node:assert/strict';
import { rotateVector, visibleFrames, tfGeometry, isStandardFrame, AXIS_COLORS } from '../../public/js/geometry/tf.js';
import { TfDisplay } from '../../public/js/displays/tf.js';
import { defaultsOf } from '../../public/js/core/properties.js';

const S = Math.SQRT1_2;
const ID = { w: 1, x: 0, y: 0, z: 0 };
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);

const transforms = {
	base_link: { parent: "odom", translation: { x: 1, y: 0, z: 0 }, rotation: ID },
	lidar: { parent: "base_link", translation: { x: 0, y: 0, z: 0.5 }, rotation: ID },
};
const absolute = {
	odom: { translation: { x: 0, y: 0, z: 0 }, rotation: ID },
	base_link: { translation: { x: 1, y: 0, z: 0 }, rotation: { w: S, x: 0, y: 0, z: S } },
	lidar: { translation: { x: 1, y: 0, z: 0.5 }, rotation: ID },
};

test('rotateVector applies a quaternion rotation', () => {
	assert.ok(close(rotateVector(ID, [1, 2, 3]), [1, 2, 3]));
	assert.ok(close(rotateVector({ w: S, x: 0, y: 0, z: S }, [1, 0, 0]), [0, 1, 0]));
	assert.ok(close(rotateVector({ w: S, x: S, y: 0, z: 0 }, [0, 1, 0]), [0, 0, 1]));
});

test('visibleFrames shows every frame by default and records the ones it has not seen', () => {
	const visibility = {};
	const r = visibleFrames(transforms, absolute, visibility);
	assert.deepEqual([...r.frames].sort(), ["base_link", "lidar", "odom"]);
	assert.equal(r.changed, true);
	assert.deepEqual(visibility, { base_link: true, odom: true, lidar: true });
	assert.equal(visibleFrames(transforms, absolute, visibility).changed, false);
});

test('visibleFrames leaves out hidden frames and frames with no absolute transform', () => {
	const r = visibleFrames(transforms, { odom: absolute.odom, lidar: absolute.lidar }, { lidar: false });
	assert.deepEqual([...r.frames], ["odom"]);
});

test('tfGeometry draws three coloured axes per frame, rotated with the frame', () => {
	const g = tfGeometry(transforms, absolute, new Set(["base_link"]), 2);
	assert.equal(g.axes.length, 3 * 6);
	// X axis of a frame yawed 90 degrees points along +Y
	assert.ok(close([...g.axes.slice(0, 6)], [1, 0, 0, 1, 2, 0]));
	// Z axis is unchanged by yaw
	assert.ok(close([...g.axes.slice(12, 18)], [1, 0, 0, 1, 0, 2]));
	assert.ok(close([...g.colors.slice(0, 6)], [...AXIS_COLORS.x, ...AXIS_COLORS.x]));
	assert.ok(close([...g.colors.slice(12, 18)], [...AXIS_COLORS.z, ...AXIS_COLORS.z]));
	assert.deepEqual(g.labels, [{ name: "base_link", x: 1, y: 0, z: 0 }]);
});

test('tfGeometry links each frame to its parent, and skips frames with no parent transform', () => {
	const g = tfGeometry(transforms, absolute, new Set(["odom", "base_link", "lidar"]), 1);
	assert.equal(g.links.length, 2 * 6);
	assert.ok(close([...g.links.slice(0, 6)], [1, 0, 0, 0, 0, 0]));
	assert.ok(close([...g.links.slice(6, 12)], [1, 0, 0.5, 1, 0, 0]));
});

test('tfGeometry ignores frames whose transform is missing or incomplete', () => {
	const g = tfGeometry(transforms, { odom: absolute.odom, bad: { translation: null } }, new Set(["odom", "bad", "gone"]), 1);
	assert.equal(g.labels.length, 1);
	assert.equal(g.axes.length, 18);
});

test('isStandardFrame matches the usual mobile-base frame names', () => {
	assert.equal(isStandardFrame("base_link"), true);
	assert.equal(isStandardFrame("robot1/odom"), true);
	assert.equal(isStandardFrame("camera_optical"), false);
});

test('TfDisplay declares every option the current TF widget has', () => {
	assert.equal(TfDisplay.type, "tf");
	assert.deepEqual(defaultsOf(TfDisplay.properties), {
		show_names: true, show_axes: true, show_lines: true, scale: 1, frame_visibility: {},
	});
});
