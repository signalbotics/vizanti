import test from 'node:test';
import assert from 'node:assert/strict';
import {
	clearText, duration, BEHAVIORS, behaviorGoal, behaviorFeedbackText, behaviorResultText,
	nodeNames, stateLabel, managerSummary,
} from '../vizanti/nav2_tools_logic.js';

test('clearing costmaps: both services, and both answers (Jazzy has no success field)', () => {
	assert.equal(clearText('Global', {}), 'Global costmap cleared.');
	assert.equal(clearText('Local', { success: true }), 'Local costmap cleared.');
	assert.equal(clearText('Local', { success: false }), 'Local costmap: Nav2 could not clear it.');
});

test('behaviour goals carry only the fields Humble, Jazzy and later all have', () => {
	assert.deepEqual(duration(2.5), { sec: 2, nanosec: 500000000 });
	assert.deepEqual(duration(-1), { sec: 0, nanosec: 0 });
	const spin = behaviorGoal('spin', { angle: -90 }, 10);
	assert.ok(Math.abs(spin.target_yaw + Math.PI / 2) < 1e-9);
	assert.deepEqual(spin.time_allowance, { sec: 10, nanosec: 0 });
	assert.equal('disable_collision_checks' in spin, false); // left out: collision checks stay on
	// a back up is given as a positive distance and speed; Nav2 turns it backwards
	assert.deepEqual(behaviorGoal('backup', { distance: -0.3, speed: -0.05 }, 0), { target: { x: 0.3, y: 0, z: 0 }, speed: 0.05, time_allowance: { sec: 0, nanosec: 0 } });
	assert.equal(behaviorGoal('drive', { distance: 1, speed: 0.1 }).target.x, 1);
	assert.deepEqual(behaviorGoal('wait', { time: 5 }), { time: { sec: 5, nanosec: 0 } });
	assert.deepEqual(behaviorGoal('assisted_teleop', { time: 30 }), { time_allowance: { sec: 30, nanosec: 0 } });
	assert.deepEqual(BEHAVIORS.map((b) => b.action), ['/spin', '/backup', '/drive_on_heading', '/wait', '/assisted_teleop']);
	assert.throws(() => behaviorGoal('dance', {}));
});

test('behaviour feedback and results read as a sentence', () => {
	assert.equal(behaviorFeedbackText('spin', { angular_distance_traveled: Math.PI / 4 }), '45° turned');
	assert.equal(behaviorFeedbackText('backup', { distance_traveled: 0.123 }), '0.12 m driven');
	assert.equal(behaviorFeedbackText('wait', { time_left: { sec: 3, nanosec: 500000000 } }), '3.5 s left');
	assert.equal(behaviorResultText('Spin', { status: 'succeeded', ok: true, values: { total_elapsed_time: { sec: 4, nanosec: 0 } } }), 'Spin: done after 4.0 s.');
	assert.equal(behaviorResultText('Back up', { status: 'aborted', ok: true, values: { error_code: 714, error_msg: '' } }), 'Back up: aborted (collision ahead).');
	assert.equal(behaviorResultText('Spin', { status: 'aborted', ok: true, values: { error_code: 701, error_msg: 'Took too long' } }), 'Spin: aborted (Took too long).');
	assert.equal(behaviorResultText('Wait', { status: 'canceled', ok: true, values: {} }), 'Wait: cancelled.');
	assert.equal(behaviorResultText('Spin', { ok: false, values: 'No action server available' }), 'Spin: No action server available');
});

test('lifecycle: node names from the manager, states from each node', () => {
	assert.deepEqual(nodeNames({ values: [{ type: 9, string_array_value: ['controller_server', 'planner_server'] }] }), ['controller_server', 'planner_server']);
	assert.deepEqual(nodeNames({ values: [{ type: 0 }] }), []);
	assert.deepEqual(stateLabel({ current_state: { id: 3, label: 'active' } }), { text: 'active', color: 'green' });
	assert.deepEqual(stateLabel({ current_state: { id: 2, label: 'inactive' } }), { text: 'inactive', color: 'orange' });
	assert.deepEqual(stateLabel(null), { text: 'not answering', color: 'red' });
	assert.equal(managerSummary('lifecycle_manager_navigation', [{ text: 'active' }, { text: 'inactive' }]), 'lifecycle_manager_navigation: 1 of 2 active');
});

import { planGoal, planSummary, planErrorText, saveMapRequest, saveMapText, followErrorText } from '../vizanti/nav2_tools_logic.js';

test('plan: from the robot to a goal, in words', () => {
	const { goal } = planGoal({ x: '1.5', y: '-2', yaw: '90', plannerId: '' }, 'map', { sec: 1, nanosec: 0 });
	assert.equal(goal.use_start, false); // the planner finds the robot in TF
	assert.deepEqual(goal.goal.pose.position, { x: 1.5, y: -2, z: 0 });
	assert.ok(Math.abs(2 * Math.atan2(goal.goal.pose.orientation.z, goal.goal.pose.orientation.w) - Math.PI / 2) < 1e-9);
	assert.equal('viapoints' in goal, false); // Kilted+ only; none without it
	assert.match(planGoal({ x: '', y: '1' }).error, /X and a Y/);
	const p = (x, y) => ({ pose: { position: { x, y } } });
	assert.equal(planSummary({ path: { poses: [p(0, 0), p(3, 4)] }, planning_time: { sec: 0, nanosec: 50000000 } }), 'Path: 5.00 m, 2 poses, planned in 0.05 s');
	assert.equal(planErrorText({ error_code: 206 }), 'the goal is in an occupied cell');
	assert.equal(planErrorText({ error_code: 204, error_msg: 'plugin failed to plan from (-1.22, -0.51) [q: ...] ...' }), 'the goal is outside the map');
	assert.equal(planErrorText({ error_code: 200, error_msg: 'Planner crashed' }), 'Planner crashed'); // unknown error: Nav2's words
	assert.equal(followErrorText({ error_code: 105, error_msg: '' }), 'the robot made no progress');
});

test('save map: a path without an extension, and both answers', () => {
	const { request } = saveMapRequest({ path: ' /home/robot/maps/office.yaml ', format: 'png' });
	assert.deepEqual(request, { map_topic: '/map', map_url: '/home/robot/maps/office', image_format: 'png', map_mode: 'trinary', free_thresh: 0.25, occupied_thresh: 0.65 });
	assert.match(saveMapRequest({ path: '' }).error, /path to save to/);
	assert.equal(saveMapText({ result: true }, request), 'Saved /home/robot/maps/office.png and /home/robot/maps/office.yaml on the robot.');
	assert.match(saveMapText({ result: false }, request), /could not save/);
});
