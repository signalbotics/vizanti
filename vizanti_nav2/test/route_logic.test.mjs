import test from 'node:test';
import assert from 'node:assert/strict';
import { nodeId, routeGoal, pathLength, routeSummary, routeErrorText, routeWaypoints, driveFeedbackText, driveErrorText } from '../vizanti/route_logic.js';

const pose = (x, y) => ({ pose: { position: { x, y, z: 0 } } });

test('route goals: by node ids, or from the robot to a point', () => {
	assert.equal(nodeId(' 12 '), 12);
	assert.equal(nodeId('-1'), null);
	assert.equal(nodeId('1.5'), null);
	assert.equal(nodeId('70000'), null); // node ids are uint16
	assert.deepEqual(routeGoal({ mode: 'ids', start: '4', goal: '8' }).goal, { start_id: 4, goal_id: 8, use_start: false, use_poses: false });
	assert.match(routeGoal({ mode: 'ids', start: '4', goal: '' }).error, /node ids/);
	assert.match(routeGoal({ mode: 'ids', start: '4', goal: '4' }).error, /same node/);
	const { goal } = routeGoal({ mode: 'point', x: '1.5', y: '-2' }, 'map', { sec: 3, nanosec: 0 });
	assert.equal(goal.use_poses, true);
	assert.equal(goal.use_start, false); // the route server finds the robot in TF
	assert.deepEqual(goal.goal.pose.position, { x: 1.5, y: -2, z: 0 });
	assert.equal(goal.goal.header.frame_id, 'map');
	assert.match(routeGoal({ mode: 'point', x: '', y: '1' }).error, /X and a Y/);
});

test('a route reads as its nodes, cost and length', () => {
	assert.equal(pathLength({ poses: [pose(0, 0), pose(3, 4), pose(3, 5)] }), 6);
	const result = { route: { route_cost: 3.7217, nodes: [{ nodeid: 4 }, { nodeid: 7 }, { nodeid: 8 }] }, path: { poses: [pose(0, 0), pose(0, 2.5)] } };
	assert.equal(routeSummary(result), 'Route 4 → 7 → 8: cost 3.72, 2.50 m');
	const long = { route: { route_cost: 1, nodes: Array.from({ length: 12 }, (_, i) => ({ nodeid: i })) }, path: { poses: [] } };
	assert.equal(routeSummary(long), 'Route 0 → 1 → 2 → … → 9 → 10 → 11: cost 1.00, 0.00 m');
});

test('errors in plain words, including Nav2 internals', () => {
	assert.equal(routeErrorText({ error_code: 400, error_msg: 'unordered_map::at' }), "a node id is not in the route server's graph");
	assert.match(routeErrorText({ error_code: 405 }), /no route between them/);
	assert.match(routeErrorText({ error_code: 402 }), /no valid graph/);
	assert.equal(routeErrorText({ error_code: 999, error_msg: 'odd' }), 'odd');
	assert.equal(routeErrorText({ error_code: 400 }, true), "unknown error (is each node id in the route server's graph?)");
	assert.equal(routeErrorText({ error_code: 400 }), 'unknown error');
	assert.equal(driveErrorText({ error_code: 9105, error_msg: 'Failed to make progress' }), 'Failed to make progress');
	assert.equal(driveErrorText({ error_code: 9105 }), 'error 9105');
});

test('driving a route: through its nodes, each facing the next', () => {
	const route = { header: { frame_id: 'map' }, nodes: [{ nodeid: 7, position: { x: -1.6, y: -0.6 } }, { nodeid: 8, position: { x: -1.6, y: 0.6 } }, { nodeid: 9, position: { x: -0.6, y: 0.6 } }] };
	const w = routeWaypoints(route, { sec: 1, nanosec: 0 });
	assert.equal(w.length, 3);
	assert.deepEqual(w[0].pose.position, { x: -1.6, y: -0.6, z: 0 });
	const yaw = (q) => 2 * Math.atan2(q.z, q.w);
	assert.ok(Math.abs(yaw(w[0].pose.orientation) - Math.PI / 2) < 1e-9); // towards node 8: +y
	assert.ok(Math.abs(yaw(w[1].pose.orientation)) < 1e-9); // towards node 9: +x
	assert.ok(Math.abs(yaw(w[2].pose.orientation)) < 1e-9); // the last keeps the last edge's heading
	assert.equal(w[2].header.frame_id, 'map');
	assert.deepEqual(routeWaypoints({ nodes: [] }), []);
	assert.equal(driveFeedbackText({ distance_remaining: 1.416, number_of_poses_remaining: 2 }), '1.42 m to go, 2 nodes left');
	assert.equal(driveFeedbackText({ distance_remaining: 0.2, number_of_poses_remaining: 1 }), '0.20 m to go, 1 node left');
});
