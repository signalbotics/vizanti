import test from 'node:test';
import assert from 'node:assert/strict';
import { closestParamOnLine, rayPlane, signedAngle, autoControls, feedbackMessage, INTERACTION, FEEDBACK, axisColor } from '../../public/js/geometry/interaction.js';
import { InteractiveMarkersDisplay } from '../../public/js/displays/interactive.js';
import { defaultsOf } from '../../public/js/core/properties.js';

const v = (x, y, z) => ({ x, y, z });
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('closestParamOnLine finds where a pointer ray passes closest to an axis', () => {
	// ray straight down at x = 3, axis along x through the origin
	assert.ok(near(closestParamOnLine(v(3, 0, 10), v(0, 0, -1), v(0, 0, 0), v(1, 0, 0)), 3));
	// axis offset and scaled direction
	assert.ok(near(closestParamOnLine(v(3, 5, 10), v(0, 0, -1), v(1, 5, 0), v(2, 0, 0)), 2));
	// a ray parallel to the axis gives nothing
	assert.equal(closestParamOnLine(v(0, 1, 0), v(1, 0, 0), v(0, 0, 0), v(1, 0, 0)), null);
});

test('rayPlane intersects in front of the ray only', () => {
	assert.deepEqual(rayPlane(v(1, 2, 5), v(0, 0, -1), v(0, 0, 0), v(0, 0, 1)), v(1, 2, 0));
	assert.equal(rayPlane(v(1, 2, 5), v(0, 0, 1), v(0, 0, 0), v(0, 0, 1)), null);
	assert.equal(rayPlane(v(1, 2, 5), v(1, 0, 0), v(0, 0, 0), v(0, 0, 1)), null);
});

test('signedAngle measures rotation around an axis, with sign', () => {
	assert.ok(near(signedAngle(v(1, 0, 0), v(0, 1, 0), v(0, 0, 1)), Math.PI / 2));
	assert.ok(near(signedAngle(v(1, 0, 0), v(0, -1, 0), v(0, 0, 1)), -Math.PI / 2));
	assert.ok(near(signedAngle(v(1, 0, 0), v(0, 1, 0), v(0, 0, -1)), -Math.PI / 2));
});

test('controls without markers get the RViz default handles', () => {
	const c = (mode, markers = []) => ({ interaction_mode: mode, markers });
	assert.deepEqual(autoControls(c(INTERACTION.MOVE_AXIS)), [{ kind: "arrow", direction: 1 }, { kind: "arrow", direction: -1 }]);
	assert.deepEqual(autoControls(c(INTERACTION.ROTATE_AXIS)), [{ kind: "ring" }]);
	assert.deepEqual(autoControls(c(INTERACTION.MOVE_ROTATE)), [{ kind: "ring" }]);
	assert.deepEqual(autoControls(c(INTERACTION.BUTTON)), []);
	assert.deepEqual(autoControls(c(INTERACTION.MOVE_AXIS, [{}])), []);
});

test('axisColor tints a handle by the direction of its axis', () => {
	assert.deepEqual(axisColor(v(1, 0, 0)), [1, 0, 0]);
	assert.deepEqual(axisColor(v(0, -1, 0)), [0, 1, 0]);
});

test('feedbackMessage builds an InteractiveMarkerFeedback', () => {
	const msg = feedbackMessage({
		frame: "map", stamp: { sec: 1, nanosec: 2 }, clientId: "vizanti", marker: "m", control: "move_x",
		event: FEEDBACK.POSE_UPDATE, pose: { position: v(1, 2, 3), orientation: { x: 0, y: 0, z: 0, w: 1 } },
	});
	assert.deepEqual(msg, {
		header: { frame_id: "map", stamp: { sec: 1, nanosec: 2 } },
		client_id: "vizanti", marker_name: "m", control_name: "move_x", event_type: 1,
		pose: { position: v(1, 2, 3), orientation: { x: 0, y: 0, z: 0, w: 1 } },
		menu_entry_id: 0, mouse_point: v(0, 0, 0), mouse_point_valid: false,
	});
	assert.equal(feedbackMessage({ frame: "map", stamp: { sec: 0, nanosec: 0 }, clientId: "c", marker: "m", control: "", event: FEEDBACK.MENU_SELECT, pose: { position: v(0, 0, 0), orientation: { x: 0, y: 0, z: 0, w: 1 } }, menuEntry: 3, mousePoint: v(1, 1, 1) }).mouse_point_valid, true);
});

test('InteractiveMarkersDisplay options', () => {
	assert.equal(InteractiveMarkersDisplay.type, "interactivemarkers");
	assert.deepEqual(defaultsOf(InteractiveMarkersDisplay.properties), { namespace: "", show_descriptions: true, show_axes: false });
});
