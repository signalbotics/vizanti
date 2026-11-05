import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COSTMAPS, costRequest, singleCostRequest, costText, frameFrom } from '../vizanti/costmap_cost_logic.js';

test('asks the local and global costmap services RViz asks', () => {
	assert.deepEqual(COSTMAPS.map(([, s]) => s), ['/local_costmap/get_cost_local_costmap', '/global_costmap/get_cost_global_costmap']);
});

test('one pose in the fixed frame, footprint off', () => {
	const header = { frame_id: 'map', stamp: { sec: 1, nanosec: 0 } };
	const r = costRequest({ x: 1.5, y: -2, z: 0.3 }, header);
	assert.equal(r.use_footprint, false);
	assert.equal(r.poses.length, 1);
	assert.deepEqual(r.poses[0].header, { frame_id: 'map', stamp: { sec: 0, nanosec: 0 } }); // latest TF
	assert.deepEqual(r.poses[0].pose.position, { x: 1.5, y: -2, z: 0 });
});

test('cost text as RViz logs it', () => {
	assert.equal(costText('Local', { costs: [253], success: true }), 'Local costmap cost: 253.0');
	assert.equal(costText('Global', { costs: [0] }), 'Global costmap cost: 0.0');
	assert.equal(costText('Local', { costs: [], success: true }), null);
	assert.equal(costText('Local', { costs: [5], success: false }), 'Local costmap: no cost here');
});

test('Humble / Jazzy GetCost: one x, y; -1 is outside the costmap', () => {
	assert.deepEqual(singleCostRequest({ x: 1.5, y: -2, z: 0.3 }), { use_footprint: false, x: 1.5, y: -2, theta: 0 });
	assert.equal(costText('Global', { cost: 120 }), 'Global costmap cost: 120.0');
	assert.equal(costText('Global', { cost: -1 }), 'Global costmap: no cost here');
	assert.equal(frameFrom({ values: [{ type: 4, string_value: 'odom' }] }), 'odom');
	assert.equal(frameFrom({ values: [{ type: 0 }] }), null);
	assert.deepEqual(COSTMAPS.map(([, , node]) => node), ['/local_costmap/local_costmap', '/global_costmap/global_costmap']);
});
