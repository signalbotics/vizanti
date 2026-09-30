import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolManager, TOOLS, DEFAULT_TOOL_OPTIONS, yawQuaternion, stampNow, sanitizeToolOptions } from '../../public/js/core/tools.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;

function make(options) {
	const published = [];
	const focused = [];
	const input = [];
	let pickResult = { x: 1, y: 2, z: 0 };
	const deps = {
		pick: () => pickResult,
		ground: () => pickResult && { x: pickResult.x, y: pickResult.y, z: 0 },
		focus: (p) => focused.push(p),
		setInputEnabled: (v) => input.push(v),
		publish: (topic, type, msg) => published.push({ topic, type, msg }),
		fixedFrame: () => "map",
		now: () => 1700000000123,
		requestRender() {},
	};
	const manager = new ToolManager(deps, options);
	const changes = [];
	manager.onChange = () => changes.push(manager.active);
	return { manager, published, focused, input, changes, setPick: (p) => { pickResult = p; } };
}

const click = (m, x = 10, y = 10) => { m.pointer("down", { clientX: x, clientY: y, button: 0 }); m.pointer("up", { clientX: x, clientY: y, button: 0 }); };

test('the tool list matches RViz: move, measure, point, focus, goal, estimate', () => {
	assert.deepEqual(TOOLS.map((t) => t.id), ["move", "measure", "point", "focus", "goal", "estimate"]);
	assert.deepEqual(DEFAULT_TOOL_OPTIONS, { point_topic: "/clicked_point", goal_topic: "/goal_pose", estimate_topic: "/initialpose" });
});

test('move is the default tool and leaves the camera enabled; others take the pointer', () => {
	const { manager, input, changes } = make();
	assert.equal(manager.active, "move");
	manager.select("measure");
	assert.deepEqual(input, [false]);
	manager.select("move");
	assert.deepEqual(input, [false, true]);
	assert.deepEqual(changes, ["measure", "move"]);
	manager.select("nope");
	assert.equal(manager.active, "move");
});

test('publish point sends a stamped point in the fixed frame and returns to move', () => {
	const { manager, published } = make();
	manager.select("point");
	click(manager);
	assert.equal(published.length, 1);
	assert.equal(published[0].topic, "/clicked_point");
	assert.equal(published[0].type, "geometry_msgs/msg/PointStamped");
	assert.deepEqual(published[0].msg, {
		header: { frame_id: "map", stamp: { sec: 1700000000, nanosec: 123000000 } },
		point: { x: 1, y: 2, z: 0 },
	});
	assert.equal(manager.active, "move");
});

test('a click that hits nothing publishes nothing and keeps the tool armed', () => {
	const { manager, published, setPick } = make();
	manager.select("point");
	setPick(null);
	click(manager);
	assert.equal(published.length, 0);
	assert.equal(manager.active, "point");
});

test('focus moves the camera target to the clicked point', () => {
	const { manager, focused } = make();
	manager.select("focus");
	click(manager);
	assert.deepEqual(focused, [{ x: 1, y: 2, z: 0 }]);
	assert.equal(manager.active, "move");
});

test('goal pose: press sets the position, the drag direction sets the heading', () => {
	const { manager, published, setPick } = make({ goal_topic: "/my_goal" });
	manager.select("goal");
	manager.pointer("down", { clientX: 0, clientY: 0, button: 0 });
	setPick({ x: 1, y: 5, z: 0 }); // dragged straight along +y
	manager.pointer("move", { clientX: 0, clientY: -30, button: 0 });
	assert.ok(manager.preview);
	manager.pointer("up", { clientX: 0, clientY: -30, button: 0 });
	const { topic, type, msg } = published[0];
	assert.equal(topic, "/my_goal");
	assert.equal(type, "geometry_msgs/msg/PoseStamped");
	assert.deepEqual(msg.pose.position, { x: 1, y: 2, z: 0 });
	assert.ok(near(msg.pose.orientation.z, Math.SQRT1_2) && near(msg.pose.orientation.w, Math.SQRT1_2));
	assert.equal(manager.preview, null);
	assert.equal(manager.active, "move");
});

test('pose estimate publishes a pose with the standard initial covariance', () => {
	const { manager, published, setPick } = make();
	manager.select("estimate");
	manager.pointer("down", { clientX: 0, clientY: 0, button: 0 });
	setPick({ x: 2, y: 2, z: 0 });
	manager.pointer("up", { clientX: 30, clientY: 0, button: 0 });
	const { topic, type, msg } = published[0];
	assert.equal(topic, "/initialpose");
	assert.equal(type, "geometry_msgs/msg/PoseWithCovarianceStamped");
	assert.equal(msg.pose.covariance.length, 36);
	assert.equal(msg.pose.covariance[0], 0.25);
	assert.equal(msg.pose.covariance[7], 0.25);
	assert.ok(near(msg.pose.covariance[35], 0.06853892326654787));
	assert.deepEqual(msg.pose.pose.orientation, { x: 0, y: 0, z: 0, w: 1 });
});

test('measure keeps its two points and reports the distance until another tool is chosen', () => {
	const { manager, setPick } = make();
	manager.select("measure");
	click(manager);
	setPick({ x: 4, y: 6, z: 0 });
	manager.pointer("move", { clientX: 5, clientY: 5, button: 0 });
	assert.ok(near(manager.measurement.distance, 5));
	click(manager);
	assert.equal(manager.active, "measure");
	assert.ok(near(manager.measurement.distance, 5));
	assert.equal(manager.measurement.done, true);
	// a third click starts a new measurement
	click(manager);
	assert.equal(manager.measurement.done, false);
	manager.select("move");
	assert.equal(manager.measurement, null);
});

test('other mouse buttons and escape do not trigger the tool', () => {
	const { manager, published } = make();
	manager.select("point");
	manager.pointer("down", { clientX: 0, clientY: 0, button: 2 });
	manager.pointer("up", { clientX: 0, clientY: 0, button: 2 });
	assert.equal(published.length, 0);
	manager.key("Escape");
	assert.equal(manager.active, "move");
});

test('keyboard shortcuts select tools', () => {
	const { manager } = make();
	for (const [key, id] of [["g", "goal"], ["p", "estimate"], ["c", "point"], ["f", "focus"], ["n", "measure"], ["m", "move"]]) {
		manager.key(key);
		assert.equal(manager.active, id, key);
	}
});

test('helpers', () => {
	assert.deepEqual(yawQuaternion(0), { x: 0, y: 0, z: 0, w: 1 });
	assert.deepEqual(stampNow(1700000000123), { sec: 1700000000, nanosec: 123000000 });
	assert.deepEqual(sanitizeToolOptions({ goal_topic: "/g", point_topic: 5, extra: 1 }), { point_topic: "/clicked_point", goal_topic: "/g", estimate_topic: "/initialpose" });
	assert.deepEqual(sanitizeToolOptions(null), DEFAULT_TOOL_OPTIONS);
});
