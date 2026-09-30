import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCameraState, DEFAULT_CAMERA, MIN_ZOOM, MAX_ZOOM } from '../../public/js/core/camera_state.js';

test('missing or non-object state gives the defaults', () => {
	for (const bad of [null, undefined, "x", 5, []])
		assert.deepEqual(sanitizeCameraState(bad), DEFAULT_CAMERA);
});

test('the default is the top-down view at 50 px per metre, like the current UI', () => {
	assert.equal(DEFAULT_CAMERA.mode, "topdown");
	assert.deepEqual(DEFAULT_CAMERA.topdown, { x: 0, y: 0, zoom: 50 });
});

test('valid state passes through unchanged', () => {
	const s = {
		mode: "orbit", target_frame: "base_link", follow_yaw: true,
		topdown: { x: 3, y: -2, zoom: 120 },
		orbit: { target: [1, 2, 0], position: [4, 5, 6] },
	};
	assert.deepEqual(sanitizeCameraState(s), s);
});

test('bad fields fall back individually', () => {
	const s = sanitizeCameraState({
		mode: "sideways", target_frame: 7,
		topdown: { x: NaN, y: "2", zoom: null },
		orbit: { target: [1, 2], position: [Infinity, 0, 0] },
	});
	assert.equal(s.mode, "topdown");
	assert.equal(s.target_frame, "");
	assert.deepEqual(s.topdown, { x: 0, y: 0, zoom: 50 });
	assert.deepEqual(s.orbit, DEFAULT_CAMERA.orbit);
});

test('zoom is clamped to the supported range', () => {
	assert.equal(sanitizeCameraState({ topdown: { zoom: 1e9 } }).topdown.zoom, MAX_ZOOM);
	assert.equal(sanitizeCameraState({ topdown: { zoom: 0 } }).topdown.zoom, MIN_ZOOM);
	assert.equal(sanitizeCameraState({ topdown: { zoom: -4 } }).topdown.zoom, MIN_ZOOM);
});

test('an orbit camera sitting on its target is replaced by the default', () => {
	const s = sanitizeCameraState({ orbit: { target: [1, 1, 1], position: [1, 1, 1] } });
	assert.deepEqual(s.orbit, DEFAULT_CAMERA.orbit);
});

test('the result never shares arrays with the defaults', () => {
	const s = sanitizeCameraState(null);
	s.orbit.position[0] = 99;
	assert.notEqual(DEFAULT_CAMERA.orbit.position[0], 99);
});
