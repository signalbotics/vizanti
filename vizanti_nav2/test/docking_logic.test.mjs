import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOCK_STATES, inputsEnabled, dockFeedbackRows, dockResultLabel, dropDefault, dockGoal, undockGoal } from '../vizanti/docking_logic.js';

test('buttons per state follow the RViz panel', () => {
	assert.deepEqual(DOCK_STATES.pre_initial.dock.slice(0, 2), ['Dock robot', false]);
	assert.deepEqual(DOCK_STATES.idle.dock.slice(0, 2), ['Dock robot', true]);
	assert.deepEqual(DOCK_STATES.docking.dock.slice(0, 2), ['Cancel docking', true]);
	assert.equal(DOCK_STATES.docking.undock[1], false);
	assert.deepEqual(DOCK_STATES.undocking.undock.slice(0, 2), ['Cancel undocking', true]);
	assert.equal(DOCK_STATES.undocking.dock[1], false);
});

test('dock id or dock pose is editable, never both; the pose waits for the checkbox', () => {
	assert.deepEqual(inputsEnabled('pre_initial', true, false), { nav_to_staging: false, use_dock_id: false, dock_type: false, dock_id: false, pose: false });
	assert.deepEqual(inputsEnabled('idle', true, false), { nav_to_staging: true, use_dock_id: true, dock_type: true, dock_id: true, pose: false });
	assert.deepEqual(inputsEnabled('idle', false, true), { nav_to_staging: true, use_dock_id: true, dock_type: true, dock_id: false, pose: true });
	assert.equal(inputsEnabled('idle', true, true).pose, false);
});

test('feedback and result labels', () => {
	assert.deepEqual(dockFeedbackRows({ state: 3, docking_time: { sec: 12, nanosec: 600000000 }, num_retries: 1 }),
		[['State:', 'controlling'], ['Time taken:', '13 s'], ['Retries:', '1']]);
	assert.deepEqual(dockFeedbackRows(null), [['State:', 'none'], ['Time taken:', '0 s'], ['Retries:', '0']]);
	assert.equal(dockResultLabel({ success: true, error_code: 0 }), '');
	assert.equal(dockResultLabel({ success: false, error_code: 904 }), '(failed to detect dock)');
	assert.equal(dockResultLabel({ success: false, error_code: 999 }), '(unknown)');
});

test('goals: by dock id, or by pose in map with the dock type', () => {
	assert.deepEqual(dropDefault(['Default', 'a']), ['a']);
	assert.deepEqual(dropDefault(['a']), ['a']);
	assert.deepEqual(dockGoal({ useDockId: true, navToStaging: true, dockId: 'home', dockType: 'a' }),
		{ goal: { use_dock_id: true, navigate_to_staging_pose: true, dock_id: 'home' } });
	assert.deepEqual(dockGoal({ useDockId: true, navToStaging: true, dockId: '' }), { error: 'Dock id is empty.' });
	assert.deepEqual(dockGoal({ useDockId: false, navToStaging: false, x: '1', y: '', yaw: '0' }), { error: 'Dock pose is empty.' });
	const { goal } = dockGoal({ useDockId: false, navToStaging: false, x: '1.5', y: '-2', yaw: '0', dockType: 'charger' }, { sec: 3, nanosec: 0 });
	assert.equal(goal.dock_type, 'charger');
	assert.equal(goal.use_dock_id, false);
	assert.equal(goal.dock_pose.header.frame_id, 'map');
	assert.deepEqual([goal.dock_pose.pose.position.x, goal.dock_pose.pose.position.y], [1.5, -2]);
	assert.deepEqual(undockGoal('charger'), { dock_type: 'charger' });
});
