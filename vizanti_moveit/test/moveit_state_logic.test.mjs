import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUrdf } from '../../vizanti_server/public/js/geometry/urdf.js';
import { defaultPositions, applyRobotState, isEmptyState, highlightMap } from '../vizanti/moveit_state_logic.js';

const ROBOT = parseUrdf(`<robot name="r">
  <link name="a"/><link name="b"/><link name="c"/><link name="d"/>
  <joint name="j1" type="revolute"><parent link="a"/><child link="b"/><limit lower="-1" upper="1"/></joint>
  <joint name="j2" type="revolute"><parent link="b"/><child link="c"/><limit lower="0.5" upper="1.5"/></joint>
  <joint name="j3" type="continuous"><parent link="c"/><child link="d"/></joint>
</robot>`);

test('defaults: 0, or mid-limits when 0 is out of range', () => {
	assert.deepEqual(defaultPositions(ROBOT), { j1: 0, j2: 1, j3: 0 });
});

test('a full state starts from the defaults; a diff from the current positions', () => {
	const state = { joint_state: { name: ['j1', 'nope'], position: [0.3, 9] } };
	assert.deepEqual(applyRobotState(ROBOT, { j1: 0.9, j2: 1.2, j3: 2 }, state), { j1: 0.3, j2: 1, j3: 0 });
	assert.deepEqual(applyRobotState(ROBOT, { j1: 0.9, j2: 1.2, j3: 2 }, { ...state, is_diff: true }), { j1: 0.3, j2: 1.2, j3: 2 });
});

test('empty states and highlights', () => {
	assert.equal(isEmptyState({ joint_state: { name: [] } }), true);
	assert.equal(isEmptyState({ joint_state: { name: ['j1'], position: [0] } }), false);
	assert.deepEqual([...highlightMap([{ id: 'b', color: { r: 1, g: 0, b: 0, a: 1 } }])], [['b', [1, 0, 0]]]);
});
