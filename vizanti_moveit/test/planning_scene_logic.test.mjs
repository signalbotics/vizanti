import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseUrdf } from '../../vizanti_server/public/js/geometry/urdf.js';
import { OPERATION, emptyScene, applyPlanningScene, primitiveShape } from '../vizanti/planning_scene_logic.js';

const ROBOT = parseUrdf(`<robot name="r"><link name="a"/><link name="b"/>
  <joint name="j1" type="revolute"><parent link="a"/><child link="b"/><limit lower="-3" upper="3"/></joint></robot>`);
const pose = (x) => ({ position: { x, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } });
const box = (id, op = OPERATION.ADD) => ({ id, header: { frame_id: 'world' }, pose: pose(1), operation: op,
	primitives: [{ type: 1, dimensions: [0.1, 0.2, 0.3] }], primitive_poses: [pose(0)] });

test('full scene, then diffs: add, append, move, remove', () => {
	let s = applyPlanningScene(ROBOT, emptyScene(), { name: 'kitchen', world: { collision_objects: [box('table'), box('cup')] } });
	assert.equal(s.name, 'kitchen');
	assert.deepEqual([...s.objects.keys()], ['table', 'cup']);
	s = applyPlanningScene(ROBOT, s, { is_diff: true, world: { collision_objects: [box('table', OPERATION.APPEND), { id: 'cup', operation: OPERATION.MOVE, pose: pose(5) }] } });
	assert.equal(s.objects.get('table').shapes.length, 2);
	assert.equal(s.objects.get('cup').pose.position.x, 5);
	s = applyPlanningScene(ROBOT, s, { is_diff: true, world: { collision_objects: [{ id: 'cup', operation: OPERATION.REMOVE }] } });
	assert.deepEqual([...s.objects.keys()], ['table']);
	assert.equal(s.name, 'kitchen'); // a diff keeps the name
	s = applyPlanningScene(ROBOT, s, { world: { collision_objects: [] } }); // a full scene replaces everything
	assert.equal(s.objects.size, 0);
});

test('colours, robot state and attached objects', () => {
	let s = applyPlanningScene(ROBOT, emptyScene(), {
		object_colors: [{ id: 'table', color: { r: 1, g: 0, b: 0, a: 0.5 } }],
		robot_state: { joint_state: { name: ['j1'], position: [0.7] }, attached_collision_objects: [{ link_name: 'b', object: box('tool') }] },
	});
	assert.deepEqual(s.colors.get('table'), [1, 0, 0, 0.5]);
	assert.equal(s.positions.j1, 0.7);
	assert.equal(s.attached.get('tool').link, 'b');
	s = applyPlanningScene(ROBOT, s, { is_diff: true, robot_state: { is_diff: true, attached_collision_objects: [{ link_name: 'b', object: { id: 'tool', operation: OPERATION.REMOVE } }] } });
	assert.equal(s.attached.size, 0);
	assert.equal(s.positions.j1, 0.7);
});

test('solid primitives', () => {
	assert.deepEqual(primitiveShape({ type: 1, dimensions: [1, 2, 3] }), { type: 'box', size: [1, 2, 3] });
	assert.deepEqual(primitiveShape({ type: 3, dimensions: [2, 0.5] }), { type: 'cylinder', height: 2, radius: 0.5 });
	assert.equal(primitiveShape({ type: 1, dimensions: [1] }), null);
});
