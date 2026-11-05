import test from 'node:test';
import assert from 'node:assert/strict';
import { managersFrom, managerNodes, posesIsArray, ntpGoal, ntpPosesIsArray } from '../vizanti/nav2_compat.js';

test('lifecycle managers: the setting, else nav2 (Kilted+), else navigation + localization (Humble / Jazzy)', () => {
	const jazzy = ['lifecycle_manager_map_server', 'lifecycle_manager_navigation', 'lifecycle_manager_localization'];
	assert.deepEqual(managersFrom('', jazzy), ['lifecycle_manager_navigation', 'lifecycle_manager_localization']);
	// a layout saved with the old default still finds Jazzy's managers
	assert.deepEqual(managersFrom('lifecycle_manager_nav2', jazzy), ['lifecycle_manager_navigation', 'lifecycle_manager_localization']);
	assert.deepEqual(managersFrom('', ['lifecycle_manager_nav2', 'lifecycle_manager_navigation']), ['lifecycle_manager_nav2']);
	assert.deepEqual(managersFrom('/my_manager', ['my_manager', 'lifecycle_manager_nav2']), ['my_manager']);
	assert.deepEqual(managersFrom('', ['lifecycle_manager_navigation']), ['lifecycle_manager_navigation']);
	assert.deepEqual(managersFrom('', []), ['lifecycle_manager_nav2']); // nothing up yet: keep asking
	assert.deepEqual(managerNodes(['/lifecycle_manager_navigation/manage_nodes', '/other/thing']), ['lifecycle_manager_navigation']);
});

test('NavigateThroughPoses: the goal form follows what rosapi says the robot has', async () => {
	const jazzy = [{ type: 'nav2_msgs/NavigateThroughPoses_Goal', fieldnames: ['poses', 'behavior_tree'], fieldtypes: ['geometry_msgs/PoseStamped', 'string'], fieldarraylen: [0, -1] }];
	const lyrical = [{ type: 'nav2_msgs/NavigateThroughPoses_Goal', fieldnames: ['poses', 'behavior_tree'], fieldtypes: ['nav_msgs/Goals', 'string'], fieldarraylen: [-1, -1] }];
	assert.equal(posesIsArray(jazzy), true);
	assert.equal(posesIsArray(lyrical), false);
	assert.equal(posesIsArray([]), null);
	const p = { header: { frame_id: 'map' }, pose: {} };
	assert.deepEqual(ntpGoal([p], 'map', { sec: 1, nanosec: 0 }, '', true), { poses: [p], behavior_tree: '' });
	assert.deepEqual(ntpGoal([p], 'map', { sec: 1, nanosec: 0 }, '', false), { poses: { header: { frame_id: 'map', stamp: { sec: 1, nanosec: 0 } }, goals: [p] }, behavior_tree: '' });
	// an older rosapi without action_goal_details: by the distro
	const ctx = (distro) => ({ callService: async (name) => {
		if (name.endsWith('action_goal_details'))
			throw new Error('no such service');
		return { distro };
	} });
	assert.equal(await ntpPosesIsArray(ctx('humble')), true);
	assert.equal(await ntpPosesIsArray(ctx('lyrical')), false);
	const asked = { callService: async () => ({ typedefs: jazzy }) };
	assert.equal(await ntpPosesIsArray(asked), true);
});
