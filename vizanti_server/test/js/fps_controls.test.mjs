import test from 'node:test';
import assert from 'node:assert/strict';
import { viewAngles, turn, translate } from '../../public/js/core/fps_controls.js';
import { sanitizeCameraState } from '../../public/js/core/camera_state.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const nearVec = (a, b) => a.every((v, i) => near(v, b[i]));

test("viewAngles reads yaw, pitch and distance from position and look point", () => {
	const { yaw, pitch, distance } = viewAngles([0, 0, 0], [0, 2, 0]);
	assert.ok(near(yaw, Math.PI / 2));
	assert.ok(near(pitch, 0));
	assert.ok(near(distance, 2));
	assert.ok(near(viewAngles([0, 0, 0], [1, 0, 1]).pitch, Math.PI / 4));
});

test("turn swings the look point round the camera and keeps its distance", () => {
	const target = turn([1, 1, 1], [3, 1, 1], Math.PI / 2, 0);
	assert.ok(nearVec(target, [1, 3, 1]));
	const up = turn([0, 0, 0], [1, 0, 0], 0, Math.PI / 4);
	assert.ok(nearVec(up, [Math.SQRT1_2, 0, Math.SQRT1_2]));
});

test("turn stops just short of looking straight up or down", () => {
	const target = turn([0, 0, 0], [1, 0, 0], 0, 10);
	const { pitch, distance } = viewAngles([0, 0, 0], target);
	assert.ok(pitch < Math.PI / 2 && pitch > Math.PI / 2 - 0.05);
	assert.ok(near(distance, 1));
});

test("translate moves forward along the view, sideways on the level, and up along z", () => {
	// looking along +x and 45 degrees down
	const position = [0, 0, 1];
	const target = [1, 0, 0];
	const forward = translate(position, target, Math.SQRT2, 0, 0);
	assert.ok(nearVec(forward.position, [1, 0, 0]));
	assert.ok(nearVec(forward.target, [2, 0, -1]));

	const right = translate(position, target, 0, 2, 0);
	assert.ok(nearVec(right.position, [0, -2, 1]));
	assert.ok(nearVec(right.target, [1, -2, 0]));

	const up = translate(position, target, 0, 0, 3);
	assert.ok(nearVec(up.position, [0, 0, 4]));
	assert.ok(nearVec(up.target, [1, 0, 3]));
});

test("the camera state keeps fps mode", () => {
	assert.equal(sanitizeCameraState({ mode: "fps" }).mode, "fps");
	assert.equal(sanitizeCameraState({ mode: "orbit" }).mode, "orbit");
	assert.equal(sanitizeCameraState({ mode: "fly" }).mode, "topdown");
});
