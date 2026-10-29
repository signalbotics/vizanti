import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseUrdf } from '../../vizanti_server/public/js/geometry/urdf.js';
import { parseSrdf, groupJoints, endEffectorLink, planningGroups, ikRequest, ikSolution, moveGroupGoal, errorName } from '../vizanti/motion_planning_logic.js';

// MoveIt's Panda, as its demo publishes it (moveit_resources_panda_moveit_config)
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const robot = parseUrdf(fixture('panda.urdf'));
const srdf = parseSrdf(fixture('panda.srdf'));
const ARM = [1, 2, 3, 4, 5, 6, 7].map((i) => `panda_joint${i}`);

test('SRDF: groups, end effector, named states', () => {
	assert.deepEqual(Object.keys(srdf.groups), ['panda_arm', 'hand', 'panda_arm_hand']);
	assert.deepEqual(srdf.groups.panda_arm.chains, [['panda_link0', 'panda_link8']]);
	assert.deepEqual(srdf.endEffectors, [{ name: 'hand', link: 'panda_link8', group: 'hand', parentGroup: 'panda_arm' }]);
	assert.deepEqual(Object.keys(srdf.states.panda_arm), ['ready', 'extended', 'transport']);
	assert.equal(srdf.states.panda_arm.ready.panda_joint4, -2.356);
	assert.deepEqual(srdf.states.hand.open, { panda_finger_joint1: 0.035, panda_finger_joint2: 0.035 });
});

test('group joints: chains, links, subgroups; mimic joints left out', () => {
	assert.deepEqual(groupJoints(robot, srdf, 'panda_arm'), ARM);
	assert.deepEqual(groupJoints(robot, srdf, 'hand'), ['panda_finger_joint1']);
	assert.deepEqual(groupJoints(robot, srdf, 'panda_arm_hand'), [...ARM, 'panda_finger_joint1']);
	assert.deepEqual(planningGroups(robot, srdf), ['panda_arm', 'hand', 'panda_arm_hand']);
});

test('the end-effector handle sits on the end effector parent link', () => {
	assert.equal(endEffectorLink(robot, srdf, 'panda_arm'), 'panda_link8');
	assert.equal(endEffectorLink(robot, srdf, 'hand'), null);
});

test('IK request and solution', () => {
	const pose = { position: { x: 0.3, y: 0, z: 0.5 }, orientation: { x: 1, y: 0, z: 0, w: 0 } };
	const r = ikRequest({ group: 'panda_arm', positions: { panda_joint1: 0.1 }, joints: ARM, link: 'panda_link8', frame: 'panda_link0', pose });
	assert.equal(r.ik_request.ik_link_name, 'panda_link8');
	assert.equal(r.ik_request.pose_stamped.header.frame_id, 'panda_link0');
	assert.equal(r.ik_request.robot_state.joint_state.position[0], 0.1);
	assert.deepEqual(r.ik_request.timeout, { sec: 0, nanosec: 100000000 });
	assert.deepEqual(ikSolution({ error_code: { val: 1 }, solution: { joint_state: { name: ['panda_joint1'], position: [0.5] } } }, { panda_joint2: 1 }), { panda_joint1: 0.5, panda_joint2: 1 });
	assert.equal(ikSolution({ error_code: { val: -31 } }, {}), null);
	assert.equal(errorName(-31), 'NO_IK_SOLUTION');
});

test('MoveGroup goal: joint goal of the group, current start state', () => {
	const g = moveGroupGoal({ group: 'panda_arm', goal: { panda_joint1: 1 }, joints: ARM, planOnly: false, velocity: 0.5 });
	assert.equal(g.request.group_name, 'panda_arm');
	assert.deepEqual(g.request.start_state, { is_diff: true });
	assert.equal(g.request.goal_constraints[0].joint_constraints.length, 7);
	assert.equal(g.request.goal_constraints[0].joint_constraints[0].position, 1);
	assert.equal(g.request.max_velocity_scaling_factor, 0.5);
	assert.equal(g.planning_options.plan_only, false);
});
