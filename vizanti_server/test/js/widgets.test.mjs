import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProps } from '../../public/js/core/properties.js';
import { BatteryWidget, batteryIcon, batteryReadout } from '../../public/js/displays/battery_widget.js';
import { TemperatureWidget, temperatureBand } from '../../public/js/displays/temperature_widget.js';
import { SpeedometerWidget, SpeedTracker, formatDial } from '../../public/js/displays/speedometer_widget.js';

test('batteryIcon picks the level band and the charging variant', () => {
	assert.equal(batteryIcon(0.1, false), "assets/battery_20.svg");
	assert.equal(batteryIcon(0.2, false), "assets/battery_20.svg");
	assert.equal(batteryIcon(0.55, true), "assets/battery_60_charging.svg");
	assert.equal(batteryIcon(1, false), "assets/battery_100.svg");
	assert.equal(batteryIcon(NaN, false), "assets/battery_unknown.svg");
});

test('batteryReadout formats the message and leaves unknown fields as a dash', () => {
	const r = batteryReadout({
		percentage: 0.734, voltage: 24.2, current: 0, charge: NaN, capacity: 10,
		cell_voltage: [4.1, 4.05], power_supply_status: 2, power_supply_health: 1, power_supply_technology: 3,
	});
	assert.equal(r.percentage, "73 %");
	assert.equal(r.voltage, "24.20 V");
	assert.equal(r.current, "–");
	assert.equal(r.charge, "–");
	assert.equal(r.cells, "4.10 V, 4.05 V");
	assert.deepEqual([r.status, r.health, r.chemistry], ["Discharging", "Good", "LiPo"]);
	assert.equal(batteryReadout(null).percentage, "–");
});

test('temperatureBand compares against the thresholds', () => {
	assert.equal(temperatureBand(70, 20, 60), "hot");
	assert.equal(temperatureBand(10, 20, 60), "cold");
	assert.equal(temperatureBand(40, 20, 60), "warm");
	assert.equal(temperatureBand(undefined, 20, 60), "unknown");
});

test('SpeedTracker averages the speed and tracks min / max', () => {
	const t = new SpeedTracker();
	assert.equal(t.add({ x: 0, y: 0, z: 0 }, 0), false); // first sample: no speed yet
	assert.equal(t.add({ x: 1, y: 0, z: 0 }, 1), true);
	assert.equal(t.average, 1);
	assert.equal(t.add({ x: 1, y: 0, z: 0 }, 1.005), false); // duplicate stamp
	t.add({ x: 4, y: 0, z: 0 }, 2); // 3 m/s, filtered to 2
	assert.equal(t.samples.at(-1), 2);
	assert.equal(t.average, 1.5);
	assert.equal(t.min, 1);
	assert.equal(t.max, 1.5);
	assert.equal(t.needle, 1);
	t.reset();
	assert.equal(t.samples.length, 0);
	assert.equal(t.needle, 0);
});

test('formatDial fits four digits', () => {
	assert.equal(formatDial(1.23456), "1.235");
	assert.equal(formatDial(12.345), "12.35");
	assert.equal(formatDial(1234.5), "1234");
	assert.equal(formatDial(123456), "9999");
});

test('the ported widgets read the old template settings', () => {
	const check = (Cls, legacy, expected) => {
		const { values } = resolveProps(Cls.properties, Cls.migrateProps(legacy));
		for (const [key, value] of Object.entries(expected))
			assert.equal(values[key], value, `${Cls.type}.${key}`);
	};
	check(BatteryWidget, { state: { topic: "/battery" } }, { topic: "/battery", throttle: 500, show_panel: false });
	check(TemperatureWidget, { state: { topic: "/temp", high: "45.5", low: "" } }, { topic: "/temp", high: 45.5, low: 20 });
	check(SpeedometerWidget, { state: { frame: "base_footprint", fixed_frame: "map", units: "km/h" } },
		{ frame: "base_footprint", fixed_frame: "map", units: "km/h" });
	check(SpeedometerWidget, { state: { units: "warp" } }, { frame: "base_link", units: "m/s" });
	// props saved by the native widget pass through unchanged
	check(TemperatureWidget, { topic: "/t", high: 30 }, { topic: "/t", high: 30 });
});

import { ButtonWidget, buttonIcon } from '../../public/js/displays/button_widget.js';

test('buttonIcon shows state only for the stateful types', () => {
	assert.equal(buttonIcon("std_msgs/msg/Bool", true), "assets/button_true.svg");
	assert.equal(buttonIcon("std_srvs/srv/SetBool", false), "assets/button_false.svg");
	assert.equal(buttonIcon("std_msgs/msg/Bool", undefined), "assets/button.svg");
	assert.equal(buttonIcon("std_srvs/srv/Trigger", true), "assets/button.svg");
});

test('the button reads the old template settings', () => {
	const { values } = resolveProps(ButtonWidget.properties, ButtonWidget.migrateProps({
		state: { topic: "/reset", text: "Reset", typedict: { "/reset": "std_srvs/srv/Trigger", "/other": "std_msgs/msg/Bool" } },
	}));
	assert.deepEqual([values.topic, values.text, values.topic_type], ["/reset", "Reset", "std_srvs/srv/Trigger"]);
	const unknown = ButtonWidget.migrateProps({ state: { topic: "/x", text: "X", typedict: {} } });
	assert.equal(unknown.topic_type, undefined);
});

import { CompressedImageDisplay, StreamStats, formatBytes } from '../../public/js/displays/compressed_image.js';

test('compressed image stream statistics', () => {
	assert.equal(formatBytes(512), "512 B");
	assert.equal(formatBytes(2048), "2.0 kB");
	assert.equal(formatBytes(3 * 1024 * 1024), "3.00 MB");
	const stats = new StreamStats(5);
	assert.ok(Number.isNaN(stats.rate));
	for (let i = 0; i < 8; i++)
		stats.add(i * 100, 1000);
	assert.equal(stats.samples.length, 5);
	assert.ok(Math.abs(stats.rate - 10) < 1e-9);
	assert.equal(stats.meanBytes, 1000);
});

test('compressed image reads the old template settings', () => {
	const { values } = resolveProps(CompressedImageDisplay.properties, CompressedImageDisplay.migrateProps({
		state: { topic: "/cam/compressed", opacity: "0.7", throttle: "250", width: "25", img_offset_x: 80, img_offset_y: 20, rotation: "90" },
	}));
	assert.deepEqual([values.topic, values.opacity, values.throttle, values.rotation, values.corner], ["/cam/compressed", 0.7, 250, 90, "top-right"]);
	assert.equal(values.size, Math.round(0.25 * 1920));
});

import { echoLines } from '../../public/js/displays/inspector_widget.js';

test('echoLines indents nested fields and cuts long arrays and strings', () => {
	const lines = echoLines({ header: { frame_id: "map" }, data: new Uint8Array(5), ranges: [1, 2, 3], note: "x".repeat(10) },
		{ maxArray: 2, maxString: 4 });
	assert.deepEqual(lines.map((l) => "  ".repeat(l.depth) + l.text), [
		"header:", "  frame_id: map",
		"data: Uint8Array(5)", "  [0]: 0", "  [1]: 0", "  … 3 more",
		"ranges: array(3)", "  [0]: 1", "  [1]: 2", "  … 1 more",
		"note: xxxx… [10 characters]",
	]);
	assert.equal(echoLines({ a: new Array(10).fill(0) }, { maxLines: 3, maxArray: 100 }).at(-1).text, "… (cut at 3 lines)");
});

import { groupParameters, parameterText } from '../../public/js/displays/reconfigure_widget.js';

test('parameters group by their dots and convert typed text', () => {
	const tree = groupParameters([["use_sim_time", false, 1], ["controller.kp", 1.5, 3], ["controller.limits.max", 10, 2]]);
	assert.deepEqual(tree.use_sim_time, ["use_sim_time", false, 1]);
	assert.deepEqual(tree.controller.kp, ["controller.kp", 1.5, 3]);
	assert.deepEqual(tree.controller.limits.max, ["controller.limits.max", 10, 2]);
	assert.equal(parameterText(1, true), "true");
	assert.equal(parameterText(2, "1000"), "1000"); // not "1,000"
	assert.equal(parameterText(2, "1.5"), null);
	assert.equal(parameterText(3, "2.5e-3"), "0.0025");
	assert.equal(parameterText(3, ""), null);
	assert.equal(parameterText(4, "hello"), "hello");
});

import { timestampedPath, topicsByType, RosbagWidget } from '../../public/js/displays/rosbag_widget.js';

test('bag recorder helpers', () => {
	assert.equal(timestampedPath("~/bags/run.bag", new Date(2026, 9, 6, 14, 5)), "~/bags/2026-10-06-14-05-run.bag");
	assert.equal(timestampedPath("run", new Date(2026, 0, 2, 3, 4)), "2026-01-02-03-04-run");
	const groups = topicsByType({ topics: ["/scan", "/tf", "/vizanti/tf_consolidated", "/odom"], types: ["sensor_msgs/msg/LaserScan", "tf2_msgs/msg/TFMessage", "tf2_msgs/msg/TFMessage", "nav_msgs/msg/Odometry"] });
	assert.deepEqual([...groups.keys()], ["nav_msgs/msg/Odometry", "sensor_msgs/msg/LaserScan", "tf2_msgs/msg/TFMessage"]);
	assert.deepEqual(groups.get("tf2_msgs/msg/TFMessage"), ["/tf"]);
	const { values } = resolveProps(RosbagWidget.properties, RosbagWidget.migrateProps({ state: { path: "~/x.bag", topic_list: ["/a", "/b"] } }));
	assert.deepEqual([values.path, values.topics], ["~/x.bag", ["/a", "/b"]]);
});

import { nodeCommand, stripEscapes } from '../../public/js/displays/nodemgr_widget.js';

test('node manager commands and doctor output', () => {
	assert.equal(nodeCommand("demo_nodes_cpp", "talker"), "ros2 run demo_nodes_cpp talker");
	assert.equal(nodeCommand("nav2_bringup", "navigation_launch.py"), "ros2 launch nav2_bringup navigation_launch.py");
	assert.equal(nodeCommand("pkg", "x", "launch"), "ros2 launch pkg x");
	assert.equal(stripEscapes("\x1B[1mUNIQUE\x1B[0m ok \x1B[31mred\x1B[0m"), "UNIQUE ok red");
});

import { DiagnosticsModel, DiagnosticsWidget } from '../../public/js/displays/diagnostics_widget.js';

test('diagnostics model: logs group per node, repeat lines count, worst level wins', () => {
	const m = new DiagnosticsModel(true);
	const log = (name, level, msg) => m.add({ name, level, msg, file: "/src/a/node.cpp", function: "tick", line: 7 }, 100);
	log("planner", 20, "ok");
	log("planner", 20, "ok");
	log("planner", 40, "boom");
	log("vizanti_rosbridge", 50, "ignored");
	const g = m.groups.get("planner");
	assert.equal(m.groups.size, 1);
	assert.equal(g.history.length, 2);
	assert.equal(g.history[0].count, 2);
	assert.equal(g.history[0].location, "node.cpp:tick:7");
	assert.equal(g.level, 40);
	assert.equal(m.worstIcon(), "red");
	assert.equal(m.worstIcon(4), "default"); // nothing FATAL
});

test('diagnostics model: statuses keep key / value entries; icon by worst status', () => {
	const m = new DiagnosticsModel(false);
	m.add({ status: [
		{ level: 0, name: "motors", message: "fine", hardware_id: "mc1", values: [{ key: "temp", value: "40" }] },
		{ level: 1, name: "battery", message: "low", hardware_id: "", values: [] },
	] });
	assert.deepEqual(m.list().map((g) => g.key), ["battery", "motors"]);
	assert.equal(m.groups.get("motors").message, "fine [mc1]");
	assert.equal(m.groups.get("motors").entries.get("temp").value, "40");
	assert.equal(m.worstIcon(), "yellow");
	const { values } = resolveProps(DiagnosticsWidget.properties, DiagnosticsWidget.migrateProps({ state: { topic: "/rosout", throttle: "0", opened: ["planner"] } }));
	assert.deepEqual([values.topic, values.throttle, values.opened], ["/rosout", 0, ["planner"]]);
});

import { TeleopDrive, ramp, twistFor, presetProps, keyLabel } from '../../public/js/geometry/teleop.js';
import { TeleopWidget } from '../../public/js/displays/teleop_widget.js';

test('teleop drive: ramp, stick mapping, car-like reverse, coast and instant stop', () => {
	const cfg = { axis_vert: "linear_x", axis_horiz: "angular_z", vel_vert: 1, vel_horiz: 2, accel_vert: 2, accel_horiz: 12, invert_vert: false, invert_horiz: false, ackermann_emulation: true, instant_stop: false };
	assert.equal(ramp(0, 1, 2), 0.1);
	assert.equal(ramp(0, 1, 12), 1);
	const d = new TeleopDrive();
	d.setTargets(cfg, { angle: Math.PI / 2, force: 1 }); // stick straight up
	let t = d.step(cfg);
	assert.ok(Math.abs(t.linear.x - 0.1) < 1e-9);
	assert.ok(Math.abs(t.angular.z) < 1e-9);
	d.setTargets(cfg, { angle: 0, force: 1 }); // stick right: turn right (negative yaw), instantly
	t = d.step(cfg);
	assert.equal(t.angular.z, -2);
	d.setTargets(cfg, { vert: -1, horiz: 1 }); // backing up while steering right: car-like swap
	assert.equal(d.horizTarget, 2);
	for (let i = 0; i < 5; i++)
		d.step(cfg); // build up speed: -0.4 m/s
	d.release(cfg);
	let steps = 0;
	while (d.step(cfg) && steps < 100)
		steps++;
	assert.ok(steps > 0 && steps < 100 && !d.moving);
	d.setTargets(cfg, { vert: 1 });
	d.step(cfg);
	d.release({ ...cfg, instant_stop: true });
	assert.equal(d.moving, false);
	assert.deepEqual(twistFor(1, 2, { axis_vert: "linear_z", axis_horiz: "none", invert_vert: true }), { linear: { x: 0, y: 0, z: -1 }, angular: { x: 0, y: 0, z: 0 } });
	assert.equal(presetProps("holonomic").axis_horiz, "linear_y");
	assert.equal(presetProps("diffdrive").keybindings.key_up, "w");
	assert.equal(keyLabel(" "), "SPACE");
});

test('teleop reads both old template formats', () => {
	const values = (s) => resolveProps(TeleopWidget.properties, TeleopWidget.migrateProps({ state: s })).values;
	const v = values({ topic: "/cmd_vel", typedict: { "/cmd_vel": "geometry_msgs/msg/TwistStamped" }, color: "#ff0000", opacity: "0.5", joy_offset_x: "30%", joy_offset_y: "70%", joy_locked: true,
		axis_vert: "linear_x", axis_horiz: "linear_y", vel_vert: 1.5, vel_horiz: 0.5, accel_vert: 3, accel_horiz: 12, keyboard_control: true, keybindings: { key_up: "i", key_down: "k", key_left: "j", key_right: "l" } });
	assert.deepEqual([v.topic_type, v.color, v.opacity, v.pos_x, v.pos_y, v.locked, v.axis_horiz, v.accel_horiz, v.keyboard, v.keybindings.key_up],
		["geometry_msgs/msg/TwistStamped", "#ff0000", 0.5, 30, 70, true, "linear_y", 12, true, "i"]);
	const old = values({ topic: "/cmd_vel", linear_velocity: 0.5, angular_velocity: 1, accel: 0.1, holonomic_swap: true, invert_angular: false });
	assert.deepEqual([old.vel_vert, old.vel_horiz, old.accel_vert, old.axis_horiz, old.ackermann_emulation], [0.5, 1, 2, "linear_y", false]);
});
