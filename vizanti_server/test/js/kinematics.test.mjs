import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUrdf } from '../../public/js/geometry/urdf.js';
import { forwardKinematics, movableJoints, jointValue } from '../../public/js/geometry/kinematics.js';

const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-9, `${a} != ${b}`));

// base -> (revolute about z, 1 m up) upper -> (revolute about z, 1 m along x) lower
//      -> (prismatic along x) slider; finger mimics the elbow at twice the angle
const ARM = `<robot name="arm">
  <link name="base"/><link name="upper"/><link name="lower"/><link name="slider"/><link name="finger"/><link name="tool"/>
  <joint name="shoulder" type="revolute"><parent link="base"/><child link="upper"/><origin xyz="0 0 1"/><axis xyz="0 0 1"/><limit lower="-1.5" upper="1.5" effort="1" velocity="1"/></joint>
  <joint name="elbow" type="continuous"><parent link="upper"/><child link="lower"/><origin xyz="1 0 0"/><axis xyz="0 0 1"/></joint>
  <joint name="slide" type="prismatic"><parent link="lower"/><child link="slider"/><origin xyz="1 0 0"/><axis xyz="1 0 0"/><limit lower="0" upper="0.5"/></joint>
  <joint name="finger_joint" type="revolute"><parent link="lower"/><child link="finger"/><axis xyz="0 0 1"/><mimic joint="elbow" multiplier="2" offset="0.1"/></joint>
  <joint name="tool_mount" type="fixed"><parent link="slider"/><child link="tool"/><origin xyz="0 0 0.2" rpy="0 0 0"/></joint>
</robot>`;

test('joints are parsed with type, parent, child, axis, limits and mimic', () => {
	const robot = parseUrdf(ARM);
	assert.equal(robot.root, 'base');
	assert.deepEqual(Object.keys(robot.joints), ['shoulder', 'elbow', 'slide', 'finger_joint', 'tool_mount']);
	assert.deepEqual(robot.joints.shoulder.limit, { lower: -1.5, upper: 1.5 });
	assert.equal(robot.joints.elbow.limit, null);
	assert.deepEqual(robot.joints.finger_joint.mimic, { joint: 'elbow', multiplier: 2, offset: 0.1 });
	assert.deepEqual(movableJoints(robot), ['shoulder', 'elbow', 'slide']);
	assert.ok(Math.abs(jointValue(robot, 'finger_joint', { elbow: 0.5 }) - 1.1) < 1e-12);
});

test('forward kinematics: zero pose, then rotated shoulder and elbow, then the slider', () => {
	const robot = parseUrdf(ARM);
	let poses = forwardKinematics(robot, {});
	near(poses.get('lower').translation, [1, 0, 1]);
	near(poses.get('tool').translation, [2, 0, 1.2]);
	poses = forwardKinematics(robot, { shoulder: Math.PI / 2 });
	near(poses.get('lower').translation, [0, 1, 1]);
	near(poses.get('slider').translation, [0, 2, 1]);
	poses = forwardKinematics(robot, { shoulder: Math.PI / 2, elbow: -Math.PI / 2, slide: 0.5 });
	near(poses.get('slider').translation, [1.5, 1, 1]);
	near(poses.get('tool').translation, [1.5, 1, 1.2]);
	const q = poses.get('slider').rotation; // net rotation 0
	near([q.x, q.y, q.z, Math.abs(q.w)], [0, 0, 0, 1]);
});
