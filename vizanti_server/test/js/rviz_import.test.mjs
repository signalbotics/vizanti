import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, rvizColor, isRvizConfig, convertRvizConfig } from '../../public/js/core/rviz_import.js';

const SAMPLE = `Panels:
  - Class: rviz_common/Displays
    Name: Displays
Visualization Manager:
  Class: ""
  Displays:
    - Alpha: 0.5
      Cell Size: 2
      Class: rviz_default_plugins/Grid
      Color: 160; 160; 164
      Enabled: true
      Name: Grid
      Value: true
    - Class: rviz_default_plugins/LaserScan
      Color: 255; 0; 0
      Color Transformer: FlatColor
      Enabled: true
      Name: Front laser
      Size (m): 0.05
      Topic:
        Depth: 5
        Durability Policy: Volatile
        Value: /scan
      Value: true
    - Class: rviz_common/Group
      Displays:
        - Class: rviz_default_plugins/Map
          Alpha: 0.7
          Enabled: true
          Name: Map
          Topic:
            Value: /map
          Value: true
        - Class: rviz_default_plugins/Pose
          Color: 0; 255; 0
          Enabled: false
          Name: Goal
          Topic: /goal_pose
          Value: false
      Enabled: false
      Name: Nav
      Value: false
    - Class: some_pkg/FancyThing
      Enabled: true
      Name: Fancy
      Value: true
    - Class: rviz_default_plugins/RobotModel
      Description Source: Topic
      Description Topic:
        Value: /robot_description
      Enabled: true
      Name: RobotModel
      TF Prefix: ""
      Value: true
  Global Options:
    Background Color: 48; 48; 48
    Fixed Frame: map
    Frame Rate: 30
  Tools:
    - Class: rviz_default_plugins/Interact
      Hide Inactive Objects: true
  Value: true
  Views:
    Current:
      Class: rviz_default_plugins/Orbit
      Distance: 10
      Focal Point:
        X: 1
        Y: 2
        Z: 0
      Name: Current View
      Pitch: 0.5
      Target Frame: <Fixed Frame>
      Yaw: 0.785
    Saved: ~
Window Geometry:
  Height: 800
`;

test("parseYaml reads nested maps, lists of maps and scalars", () => {
	const doc = parseYaml(SAMPLE);
	assert.equal(doc.Panels[0].Class, "rviz_common/Displays");
	const vm = doc["Visualization Manager"];
	assert.equal(vm.Class, "");
	assert.equal(vm.Displays.length, 5);
	assert.equal(vm.Displays[0]["Cell Size"], 2);
	assert.equal(vm.Displays[0].Alpha, 0.5);
	assert.equal(vm.Displays[0].Enabled, true);
	assert.equal(vm.Displays[1].Topic.Value, "/scan");
	assert.equal(vm.Displays[2].Displays[1].Topic, "/goal_pose");
	assert.equal(vm.Displays[2].Displays[1].Enabled, false);
	assert.equal(vm["Global Options"]["Fixed Frame"], "map");
	assert.equal(vm.Views.Current["Focal Point"].Y, 2);
	assert.equal(vm.Views.Saved, null);
	assert.equal(doc["Window Geometry"].Height, 800);
});

test("parseYaml handles quotes, comments, flow collections and list scalars", () => {
	const doc = parseYaml(`# a comment
a: 'it''s'
b: "x: y"
c: []
d: {}
e:
- one
- 2
f: [1, two]
g: true # trailing note
h: 1e3
`);
	assert.equal(doc.a, "it's");
	assert.equal(doc.b, "x: y");
	assert.deepEqual(doc.c, []);
	assert.deepEqual(doc.d, {});
	assert.deepEqual(doc.e, ["one", 2]);
	assert.deepEqual(doc.f, [1, "two"]);
	assert.equal(doc.g, true);
	assert.equal(doc.h, 1000);
});

test("rvizColor turns 'r; g; b' into hex and rejects anything else", () => {
	assert.equal(rvizColor("255; 0; 16"), "#ff0010");
	assert.equal(rvizColor("300; 0; 0"), "#ff0000");
	assert.equal(rvizColor("red"), undefined);
	assert.equal(rvizColor(undefined), undefined);
});

test("isRvizConfig spots an RViz file", () => {
	assert.equal(isRvizConfig(parseYaml(SAMPLE)), true);
	assert.equal(isRvizConfig({ version: 2, items: [] }), false);
	assert.equal(isRvizConfig(null), false);
});

test("convertRvizConfig maps displays, globals and the view", () => {
	const types = new Set(["grid", "scan", "map", "posewithcovariancestamped", "urdf"]);
	const { items, global, camera, skipped } = convertRvizConfig(parseYaml(SAMPLE), types);

	assert.deepEqual(global, { fixed_frame: "map", background: "#303030" });

	assert.deepEqual(items.map((i) => i.type), ["grid", "scan", "map", "posewithcovariancestamped", "urdf"]);
	const [grid, scan, map, pose, urdf] = items;
	assert.deepEqual(grid.props, { size: 2, colour: "#a0a0a4" });
	assert.equal(scan.name, "Front laser");
	assert.deepEqual(scan.props, { topic: "/scan", color: "#ff0000", thickness: 0.05 });
	// the group was disabled, so its children come in disabled
	assert.equal(map.enabled, false);
	assert.deepEqual(map.props, { topic: "/map", opacity: 0.7 });
	assert.deepEqual(pose.props, { topic: "/goal_pose", topic_type: "geometry_msgs/msg/PoseStamped", color: "#00ff00" });
	assert.deepEqual(urdf.props, { topic: "/robot_description" });
	assert.equal(new Set(items.map((i) => i.id)).size, items.length);
	for (const item of items)
		assert.match(item.id, /^[\w-]+$/);

	assert.deepEqual(skipped, ["Fancy (some_pkg/FancyThing)"]);

	assert.equal(camera.mode, "orbit");
	assert.equal(camera.target_frame, "");
	assert.deepEqual(camera.orbit.target, [1, 2, 0]);
	const [x, y, z] = camera.orbit.position;
	assert.ok(Math.abs(Math.hypot(x - 1, y - 2, z) - 10) < 1e-9);
	assert.ok(Math.abs(z - 10 * Math.sin(0.5)) < 1e-9);
	assert.ok(Math.abs(Math.atan2(y - 2, x - 1) - 0.785) < 1e-9);
});

test("convertRvizConfig skips types this Vizanti does not have and reads top-down views", () => {
	const doc = parseYaml(`Visualization Manager:
  Displays:
    - Class: rviz_default_plugins/Map
      Name: Map
      Topic: /map
  Views:
    Current:
      Class: rviz_default_plugins/TopDownOrtho
      Scale: 80
      X: 3
      Y: -1
      Target Frame: base_link
`);
	const { items, camera, skipped } = convertRvizConfig(doc, new Set(["grid"]));
	assert.deepEqual(items, []);
	assert.deepEqual(skipped, ["Map (rviz_default_plugins/Map)"]);
	assert.deepEqual(camera, { mode: "topdown", target_frame: "base_link", topdown: { x: 3, y: -1, zoom: 80 } });
});

test("convertRvizConfig tolerates a file with nothing in it", () => {
	const out = convertRvizConfig({ "Visualization Manager": {} }, new Set());
	assert.deepEqual(out, { items: [], global: {}, camera: undefined, skipped: [], tools: [] });
});

test("convertRvizConfig rounds float32 noise and keeps cloud colours only when flat", () => {
	const doc = parseYaml(`Visualization Manager:
  Displays:
    - Class: rviz_default_plugins/PointCloud2
      Color: 255; 255; 255
      Color Transformer: RGB8
      Name: Cloud
      Size (m): 0.009999999776482582
      Topic:
        Value: /points
    - Class: rviz_default_plugins/PointCloud2
      Color: 0; 0; 255
      Color Transformer: FlatColor
      Name: Flat
      Topic: /flat
`);
	const { items } = convertRvizConfig(doc, new Set(["pointcloud"]));
	assert.deepEqual(items[0].props, { topic: "/points", thickness: 0.01, colour_mode: "rgb" });
	assert.deepEqual(items[1].props, { topic: "/flat", color: "#0000ff", colour_mode: "flat" });
});

test("convertRvizConfig turns an FPS view into Vizanti's first-person camera", () => {
	const doc = parseYaml(`Visualization Manager:
  Views:
    Current:
      Class: rviz_default_plugins/FPS
      Pitch: 0.5
      Position:
        X: 1
        Y: 2
        Z: 3
      Yaw: 1.2
`);
	const { camera } = convertRvizConfig(doc, new Set());
	assert.equal(camera.mode, "fps");
	assert.deepEqual(camera.orbit.position, [1, 2, 3]);
	const [x, y, z] = camera.orbit.target;
	assert.ok(z < 3, "positive RViz pitch looks down");
	assert.ok(Math.abs(Math.atan2(y - 2, x - 1) - 1.2) < 1e-9);
});

test("convertRvizConfig maps point cloud colour transformers, styles and decay", () => {
	const doc = parseYaml(`Visualization Manager:
  Displays:
    - Class: rviz_default_plugins/PointCloud2
      Name: Lidar
      Color Transformer: Intensity
      Channel Name: reflectivity
      Style: Points
      Size (Pixels): 4
      Decay Time: 2.5
      Topic: /points
    - Class: rviz_default_plugins/PointCloud2
      Name: Height
      Color Transformer: AxisColor
      Axis: Z
      Style: Spheres
      Topic: /cloud
`);
	const { items } = convertRvizConfig(doc, new Set(["pointcloud"]));
	assert.deepEqual(items[0].props, { topic: "/points", style: "pixels", pixel_size: 4, colour_mode: "channel", channel: "reflectivity", decay_ms: 2500 });
	assert.deepEqual(items[1].props, { topic: "/cloud", style: "circles", colour_mode: "axis_z" });
});

test("convertRvizConfig maps the grid plane, offset and reference frame", () => {
	const doc = parseYaml(`Visualization Manager:
  Displays:
    - Class: rviz_default_plugins/Grid
      Name: Wall
      Plane: XZ
      Reference Frame: base_link
      Offset:
        X: 0
        Y: 1.5
        Z: 0
    - Class: rviz_default_plugins/Grid
      Name: Floor
      Plane: XY
      Reference Frame: <Fixed Frame>
`);
	const { items } = convertRvizConfig(doc, new Set(["grid"]));
	assert.deepEqual(items[0].props, { plane: "XZ", offset_y: 1.5, frame: "base_link" });
	assert.deepEqual(items[1].props, {});
});

test("convertRvizConfig maps both RViz IMU plugins to the IMU display", () => {
	const doc = parseYaml(`Visualization Manager:
  Displays:
    - Class: rviz_imu_plugin/Imu
      Name: IMU
      Topic: /imu/data
      Enable acceleration: false
    - Class: rviz_default_plugins/Imu
      Name: IMU2
      Topic:
        Value: /imu
`);
	const { items, skipped } = convertRvizConfig(doc, new Set(["imu"]));
	assert.deepEqual(items.map((i) => [i.type, i.props.topic]), [["imu", "/imu/data"], ["imu", "/imu"]]);
	assert.equal(items[0].props.show_acceleration, false);
	assert.deepEqual(skipped, []);
});

test("convertRvizConfig keeps RViz groups (one level) and lets plugins claim RViz classes", () => {
	class Particles { static type = "my_nav/Particle Cloud"; static rvizClass = "nav2_rviz_plugins/ParticleCloud"; static fromRviz(d) { return { topic: d.Topic?.Value, size: 2 }; } }
	class NavPanel { static type = "my_nav/Navigation 2"; static rvizClass = "nav2_rviz_plugins/Navigation 2"; }
	class GoalTool { static type = "my_nav/Goal"; static rvizClass = "nav2_rviz_plugins/GoalTool"; }
	const types = new Map([["grid", {}], ["folder", {}], ["my_nav/Particle Cloud", Particles], ["my_nav/Navigation 2", NavPanel]]);
	const doc = parseYaml(`Panels:
  - Class: rviz_common/Displays
    Name: Displays
  - Class: nav2_rviz_plugins/Navigation 2
    Name: Navigation 2
  - Class: other_pkg/Unknown Panel
    Name: Mystery
Visualization Manager:
  Displays:
    - Class: rviz_common/Group
      Name: Nav
      Enabled: false
      Displays:
        - Class: rviz_default_plugins/Grid
          Name: Grid
          Enabled: true
        - Class: rviz_common/Group
          Name: Inner
          Enabled: false
          Displays:
            - Class: nav2_rviz_plugins/ParticleCloud
              Name: Particles
              Enabled: true
              Topic:
                Value: /particle_cloud
  Tools:
    - Class: rviz_default_plugins/MoveCamera
    - Class: nav2_rviz_plugins/GoalTool
    - Class: other_pkg/Unknown Tool
`);
	const out = convertRvizConfig(doc, types, new Map([["my_nav/Goal", GoalTool]]));
	assert.deepEqual(out.items.map((i) => [i.type, i.name, i.enabled, i.container]), [
		["folder", "Nav", false, ""],
		["grid", "Grid", true, "folder_rviz_0_widget_container"],
		// the inner group is flattened into the outer one; its switch is carried by the display
		["my_nav/Particle Cloud", "Particles", false, "folder_rviz_0_widget_container"],
		["my_nav/Navigation 2", "Navigation 2", true, ""],
	]);
	assert.deepEqual(out.items[2].props, { topic: "/particle_cloud", size: 2 });
	assert.match(out.items[2].id, /^my_nav_Particle_Cloud_rviz_\d+$/);
	assert.deepEqual(out.tools, ["my_nav/Goal"]);
	assert.deepEqual(out.skipped, ["Mystery panel (other_pkg/Unknown Panel)", "tool other_pkg/Unknown Tool"]);
});
