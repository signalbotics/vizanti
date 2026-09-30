import test from 'node:test';
import assert from 'node:assert/strict';
import { saveView, removeView, sanitizeViews } from '../../public/js/core/views.js';
import { sanitizeCameraState, DEFAULT_CAMERA } from '../../public/js/core/camera_state.js';

const state = (x) => sanitizeCameraState({ topdown: { x, y: 0, zoom: 50 } });

test('saveView adds a named view, replacing one with the same name', () => {
	let views = saveView([], "front", state(1));
	views = saveView(views, "top", state(2));
	views = saveView(views, "front", state(3));
	assert.deepEqual(views.map((v) => v.name), ["front", "top"]);
	assert.equal(views[0].camera.topdown.x, 3);
});

test('saveView trims names and refuses empty ones', () => {
	assert.deepEqual(saveView([], "  lab  ", state(1)).map((v) => v.name), ["lab"]);
	assert.throws(() => saveView([], "   ", state(1)), /name/);
});

test('removeView drops a view by name', () => {
	const views = saveView(saveView([], "a", state(1)), "b", state(2));
	assert.deepEqual(removeView(views, "a").map((v) => v.name), ["b"]);
	assert.deepEqual(removeView(views, "missing").map((v) => v.name), ["a", "b"]);
});

test('sanitizeViews keeps well-formed entries from saved data', () => {
	const views = sanitizeViews([{ name: "ok", camera: { mode: "orbit" } }, { name: 5 }, null, "x", { camera: {} }]);
	assert.equal(views.length, 1);
	assert.equal(views[0].camera.mode, "orbit");
	assert.deepEqual(sanitizeViews(undefined), []);
});

test('camera state carries whether the view turns with its target frame', () => {
	assert.equal(DEFAULT_CAMERA.follow_yaw, false);
	assert.equal(sanitizeCameraState({ follow_yaw: true }).follow_yaw, true);
	assert.equal(sanitizeCameraState({ follow_yaw: "yes" }).follow_yaw, false);
});
