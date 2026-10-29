import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUrdf } from '../../vizanti_server/public/js/geometry/urdf.js';
import { stateDisplayTime, waypoints, Animator, trailIndices } from '../vizanti/trajectory_logic.js';

const ROBOT = parseUrdf(`<robot name="r"><link name="a"/><link name="b"/><link name="c"/>
  <joint name="j1" type="revolute"><parent link="a"/><child link="b"/><limit lower="-3" upper="3"/></joint>
  <joint name="j2" type="revolute"><parent link="b"/><child link="c"/><limit lower="-3" upper="3"/></joint></robot>`);
const t = (s) => ({ sec: Math.floor(s), nanosec: Math.round((s % 1) * 1e9) });

test('State Display Time: factors, fixed times, default 3x', () => {
	assert.equal(stateDisplayTime('3x'), -3);
	assert.equal(stateDisplayTime(' 0.5x '), -0.5);
	assert.equal(stateDisplayTime('0.05s'), 0.05);
	assert.equal(stateDisplayTime('fast'), -3);
	assert.equal(stateDisplayTime('0x'), -3);
});

test('waypoints from the start state and each segment, with time steps', () => {
	const msg = {
		trajectory_start: { joint_state: { name: ['j1', 'j2'], position: [0.1, 0.2] } },
		trajectory: [
			{ joint_trajectory: { joint_names: ['j1'], points: [{ positions: [0.1], time_from_start: t(0) }, { positions: [1], time_from_start: t(0.5) }] } },
			{ joint_trajectory: { joint_names: ['j2'], points: [{ positions: [2], time_from_start: t(0.25) }] } },
		],
	};
	const w = waypoints(ROBOT, {}, msg);
	assert.deepEqual(w.map((p) => p.positions), [{ j1: 0.1, j2: 0.2 }, { j1: 1, j2: 0.2 }, { j1: 1, j2: 2 }]);
	assert.deepEqual(w.map((p) => p.dt), [0, 0.5, 0.25]);
});

test('animation at a time factor, then done; looping restarts', () => {
	const points = [{ dt: 0 }, { dt: 1 }, { dt: 1 }];
	const a = new Animator(points, { displayTime: -2 }); // 2x: each step takes 0.5 s
	assert.equal(a.step(0.4).index, 0);
	assert.equal(a.step(0.2).index, 1);
	const end = a.step(0.6);
	assert.equal(end.index, 2);
	assert.equal(a.step(1).done, true);
	assert.equal(a.step(1).index, 2); // stays at the last waypoint
	const l = new Animator(points, { displayTime: -2, loop: true });
	l.step(5); l.step(5);
	assert.equal(l.step(0.01).index, 0);
});

test('fixed time per waypoint', () => {
	const a = new Animator([{ dt: 0 }, { dt: 9 }, { dt: 9 }], { displayTime: 0.1 });
	assert.equal(a.step(0.05).index, 0);
	assert.equal(a.step(0.06).index, 1);
	assert.equal(a.step(0.11).index, 2);
	assert.equal(a.step(0.11).done, true);
});

test('trail: every step-th waypoint and the last', () => {
	assert.deepEqual(trailIndices(5, 1), [0, 1, 2, 3, 4]);
	assert.deepEqual(trailIndices(5, 2), [0, 2, 4]);
	assert.deepEqual(trailIndices(6, 4), [0, 4, 5]);
});
