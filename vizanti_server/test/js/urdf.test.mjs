import test from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, parseUrdf, rpyToQuat, meshUrl } from '../../public/js/geometry/urdf.js';
import { UrdfDisplay } from '../../public/js/displays/urdf.js';
import { defaultsOf } from '../../public/js/core/properties.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;

const URDF = `<?xml version="1.0"?>
<!-- a comment with <tags> inside -->
<robot name="bot">
  <material name="blue"><color rgba="0 0 1 0.5"/></material>
  <link name="base_link">
    <visual>
      <origin xyz="0 0 0.1" rpy="0 0 1.5707963"/>
      <geometry><box size="1 2 3"/></geometry>
      <material name="blue"/>
    </visual>
    <visual>
      <geometry><cylinder radius="0.2" length="0.5"/></geometry>
      <material name="red"><color rgba="1 0 0 1"/></material>
    </visual>
    <collision>
      <geometry><sphere radius="0.3"/></geometry>
    </collision>
  </link>
  <link name="arm">
    <visual>
      <geometry><mesh filename="package://bot_description/meshes/arm.STL" scale="0.001 0.001 0.001"/></geometry>
    </visual>
  </link>
  <link name="empty"/>
  <joint name="j1" type="revolute">
    <parent link="base_link"/><child link="arm"/>
    <origin xyz="0 0 1"/>
  </joint>
</robot>`;

test('parseXml reads nested elements, attributes, self-closing tags, and skips comments', () => {
	const root = parseXml('<?xml version="1.0"?><!-- <x> --><a k="v" n=\'1\'><b/><c d="e &amp; f">text</c></a>');
	assert.equal(root.tag, "a");
	assert.deepEqual(root.attrs, { k: "v", n: "1" });
	assert.deepEqual(root.children.map((c) => c.tag), ["b", "c"]);
	assert.equal(root.children[1].attrs.d, "e & f");
});

test('parseXml reports malformed documents', () => {
	assert.throws(() => parseXml("<a><b></a>"), /closing tag/i);
	assert.throws(() => parseXml("not xml"), /no root element/i);
	assert.throws(() => parseXml("<a>"), /never closed/i);
});

test('parseUrdf lists links with their visuals and collisions', () => {
	const robot = parseUrdf(URDF);
	assert.equal(robot.name, "bot");
	assert.deepEqual(Object.keys(robot.links), ["base_link", "arm", "empty"]);
	const base = robot.links.base_link;
	assert.equal(base.visuals.length, 2);
	assert.equal(base.collisions.length, 1);
	assert.deepEqual(base.visuals[0].origin, { xyz: [0, 0, 0.1], rpy: [0, 0, 1.5707963] });
	assert.deepEqual(base.visuals[0].geometry, { type: "box", size: [1, 2, 3] });
	assert.deepEqual(base.visuals[1].geometry, { type: "cylinder", radius: 0.2, length: 0.5 });
	assert.deepEqual(base.collisions[0].geometry, { type: "sphere", radius: 0.3 });
	assert.deepEqual(robot.links.empty, { visuals: [], collisions: [] });
});

test('materials resolve by name or inline, with a grey default', () => {
	const robot = parseUrdf(URDF);
	assert.deepEqual(robot.links.base_link.visuals[0].color, [0, 0, 1, 0.5]);
	assert.deepEqual(robot.links.base_link.visuals[1].color, [1, 0, 0, 1]);
	assert.equal(robot.links.arm.visuals[0].color, null);
});

test('mesh geometry keeps its file name and scale, defaulting to unit scale', () => {
	const robot = parseUrdf(URDF);
	assert.deepEqual(robot.links.arm.visuals[0].geometry, {
		type: "mesh", filename: "package://bot_description/meshes/arm.STL", scale: [0.001, 0.001, 0.001],
	});
	assert.deepEqual(robot.links.arm.visuals[0].origin, { xyz: [0, 0, 0], rpy: [0, 0, 0] });
	const plain = parseUrdf('<robot name="r"><link name="l"><visual><geometry><mesh filename="a.dae"/></geometry></visual></link></robot>');
	assert.deepEqual(plain.links.l.visuals[0].geometry.scale, [1, 1, 1]);
});

test('broken numbers and unknown shapes do not produce NaN geometry', () => {
	const robot = parseUrdf('<robot name="r"><link name="l"><visual><origin xyz="a b" rpy="0 0"/><geometry><box size="1 x 3"/></geometry></visual><visual><geometry><capsule/></geometry></visual><visual/></link></robot>');
	assert.equal(robot.links.l.visuals.length, 0);
	assert.equal(robot.skipped, 3);
});

test('parseUrdf rejects documents that are not a robot', () => {
	assert.throws(() => parseUrdf("<sdf/>"), /not a URDF/);
});

test('rpyToQuat follows the URDF fixed-axis roll, pitch, yaw convention', () => {
	const yaw = rpyToQuat([0, 0, Math.PI / 2]);
	assert.ok(near(yaw.z, Math.SQRT1_2) && near(yaw.w, Math.SQRT1_2) && near(yaw.x, 0) && near(yaw.y, 0));
	const roll = rpyToQuat([Math.PI / 2, 0, 0]);
	assert.ok(near(roll.x, Math.SQRT1_2) && near(roll.w, Math.SQRT1_2));
	assert.deepEqual(rpyToQuat([0, 0, 0]), { x: 0, y: 0, z: 0, w: 1 });
});

test('meshUrl maps package URIs to the server route and refuses anything else', () => {
	assert.deepEqual(meshUrl("package://bot_description/meshes/arm.STL", "/viz"), { url: "/viz/package/bot_description/meshes/arm.STL", format: "stl" });
	assert.deepEqual(meshUrl("package://p/a/b.dae", ""), { url: "/package/p/a/b.dae", format: "dae" });
	assert.equal(meshUrl("package://p/x.obj", "").format, "obj");
	assert.equal(meshUrl("file:///etc/passwd", ""), null);
	assert.equal(meshUrl("package://p/../../etc/passwd.stl", ""), null);
	assert.equal(meshUrl("package://p/model.fbx", ""), null);
	assert.equal(meshUrl(undefined, ""), null);
});

test('UrdfDisplay options', () => {
	assert.equal(UrdfDisplay.type, "urdf");
	assert.deepEqual(UrdfDisplay.msgTypes, ["std_msgs/msg/String"]);
	assert.deepEqual(defaultsOf(UrdfDisplay.properties), {
		topic: "/robot_description", show_visual: true, show_collision: false, opacity: 1, tf_prefix: "", hidden_links: {},
	});
});
