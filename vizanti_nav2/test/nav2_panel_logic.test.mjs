import test from 'node:test';
import assert from 'node:assert/strict';
import { Nav2PanelController, checkLoops, goalStatusLabel, feedbackRows, waypointMarkers, waypointsToYaml, waypointsFromYaml, LIFECYCLE } from '../vizanti/nav2_panel_logic.js';

// a fake ROS: services answer from `answers`, goals stay pending until finished by hand
function fakeIo({ active = true, managers = ["lifecycle_manager_nav2"], posesIsArray = false } = {}) {
	const io = {
		calls: [], goals: [], markers: [], notes: [],
		managers: async () => managers, ntpPosesIsArray: async () => posesIsArray, baseFrame: () => "base_footprint",
		now: () => ({ sec: 1, nanosec: 0 }),
		notify: (t) => io.notes.push(t),
		publishMarkers: (m) => io.markers.push(m),
		lookupBasePose: () => ({ x: 1, y: 2, z: 0, orientation: { x: 0, y: 0, z: 0, w: 1 } }),
		callService: async (name, type, request) => {
			io.calls.push([name, request]);
			if (name.endsWith("/is_active"))
				return { success: active };
			return { success: true };
		},
		action: (name, type) => ({
			send: (goal, { onFeedback } = {}) => {
				let finish;
				const result = new Promise((r) => { finish = r; });
				const handle = { name, goal, onFeedback, cancelled: false, cancel() { this.cancelled = true; }, result, finish: (status) => finish({ status, values: {}, ok: true }) };
				io.goals.push(handle);
				return handle;
			},
		}),
	};
	return io;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('startup: active navigation goes to idle, inactive to initial; Startup and Reset call the lifecycle manager', async () => {
	const io = fakeIo({ active: false });
	const panel = new Nav2PanelController(io);
	assert.equal(panel.ui.start_reset.text, "Startup");
	assert.equal(panel.ui.start_reset.enabled, false);
	await panel.start();
	assert.equal(panel.state, "initial");
	assert.equal(panel.navigation, "inactive");
	assert.deepEqual(panel.ui.start_reset, { text: "Startup", enabled: true, tip: "Configure and activate all nav2 lifecycle nodes" });
	panel.press("start_reset");
	await tick();
	assert.equal(panel.state, "idle");
	assert.deepEqual(io.calls.at(-1), ["/lifecycle_manager_nav2/manage_nodes", { command: LIFECYCLE.STARTUP }]);
	assert.equal(panel.navigation, "active");
	assert.equal(panel.ui.start_reset.text, "Reset");
	assert.equal(panel.tabs.navToPose, true);
	panel.press("start_reset"); // Reset -> reset -> initial
	await tick();
	assert.equal(panel.state, "initial");
	assert.deepEqual(io.calls.at(-1), ["/lifecycle_manager_nav2/manage_nodes", { command: LIFECYCLE.RESET }]);
});

test('pause and resume', async () => {
	const io = fakeIo();
	const panel = new Nav2PanelController(io);
	await panel.start();
	panel.press("pause_resume");
	assert.equal(panel.state, "paused");
	assert.equal(panel.ui.pause_resume.text, "Resume");
	assert.equal(panel.ui.nav_mode.text, "");
	panel.press("pause_resume");
	await tick();
	assert.equal(panel.state, "idle");
	assert.deepEqual(io.calls.slice(-2).map(([, r]) => r.command), [LIFECYCLE.PAUSE, LIFECYCLE.RESUME]);
});

test('a goal from the tool navigates; Cancel cancels; the result returns to idle', async () => {
	const io = fakeIo();
	const panel = new Nav2PanelController(io);
	await panel.start();
	panel.newGoal({ frame: "map", x: 2, y: 3, yaw: 0 });
	assert.equal(panel.state, "running");
	assert.equal(panel.ui.start_reset.text, "Cancel");
	assert.equal(io.goals[0].name, "/navigate_to_pose");
	assert.deepEqual(io.goals[0].goal.pose.pose.position, { x: 2, y: 3, z: 0 });
	io.goals[0].onFeedback({ distance_remaining: 1.234, estimated_time_remaining: { sec: 5, nanosec: 0 }, navigation_time: { sec: 2, nanosec: 0 }, number_of_recoveries: 1, position_tracking_error: 0.1, heading_tracking_error: 0.2 });
	assert.deepEqual(panel.feedback.slice(0, 2), [["ETA:", "5 s"], ["Distance remaining:", "1.23 m"]]);
	panel.press("start_reset"); // Cancel
	assert.equal(io.goals[0].cancelled, true);
	assert.equal(panel.state, "idle");
	// a second goal that finishes
	panel.newGoal({ frame: "map", x: 1, y: 1, yaw: 0 });
	io.goals[1].finish("succeeded");
	await tick();
	assert.equal(panel.state, "idle");
	assert.deepEqual(panel.goalStatus, { title: "Feedback", text: "reached", color: "green" });
});

test('waypoint mode: accumulate from the tool, loops, follow, pause and resume, and the markers', async () => {
	const io = fakeIo();
	const panel = new Nav2PanelController(io);
	await panel.start();
	panel.press("nav_mode");
	assert.equal(panel.state, "accumulating");
	assert.equal(panel.ui.nav_mode.text, "Start Waypoint Following");
	assert.equal(panel.tabs.current, "waypoints");
	panel.newGoal({ frame: "map", x: 1, y: 0, yaw: 0 });
	panel.newGoal({ frame: "map", x: 2, y: 0, yaw: Math.PI / 2 });
	assert.equal(panel.accumulated.length, 2);
	const last = io.markers.at(-1).markers;
	assert.deepEqual(last.map((m) => m.type), [0, 2, 9, 0, 2, 9]);
	assert.equal(last[5].text, "wp_2");
	panel.setLoops("abc");
	assert.equal(panel.ui.nav_mode.enabled, false);
	assert.match(panel.waypointNote, /valid value/);
	panel.setLoops("2");
	assert.equal(panel.ui.nav_mode.enabled, true);
	assert.equal(panel.ui.pause_resume.enabled, false); // no NavigateThroughPoses with loops
	panel.press("nav_mode"); // Start Waypoint Following
	assert.equal(panel.state, "accumulated_wp");
	assert.equal(io.goals[0].name, "/follow_waypoints");
	assert.equal(io.goals[0].goal.number_of_loops, 2);
	assert.equal(io.goals[0].goal.poses.length, 2);
	panel.press("pause_wp");
	assert.equal(panel.state, "resumed_wp");
	assert.equal(io.goals[0].cancelled, true);
	assert.equal(panel.waypointNote, "Navigation is paused.");
	assert.equal(panel.ui.pause_wp.text, "Resume WaypointFollowing");
	panel.newGoal({ frame: "map", x: 9, y: 9, yaw: 0 });
	assert.equal(panel.waypointNote, "Cannot set goal in pause state");
	panel.press("pause_wp"); // resume
	assert.equal(panel.state, "accumulated_wp");
	assert.equal(io.goals[1].name, "/follow_waypoints");
	panel.press("start_reset"); // Cancel
	assert.equal(panel.state, "idle");
	assert.deepEqual(panel.accumulated, []);
});

test('waypoint mode without poses complains and goes back to idle; store initial pose prepends the robot', async () => {
	const io = fakeIo();
	const panel = new Nav2PanelController(io);
	await panel.start();
	panel.press("nav_mode");
	panel.press("nav_mode");
	assert.equal(panel.state, "idle");
	assert.match(panel.waypointNote, /forgot to select the waypoints/);
	panel.press("nav_mode");
	panel.storeInitialPose = true;
	panel.newGoal({ frame: "map", x: 5, y: 0, yaw: 0 });
	panel.press("nav_mode");
	assert.deepEqual(io.goals[0].goal.poses.map((p) => p.pose.position.x), [1, 5]);
	assert.equal(io.goals[0].goal.goal_index, 1);
});

test('navigate through poses sends nav_msgs/Goals and shows poses remaining', async () => {
	const io = fakeIo();
	const panel = new Nav2PanelController(io);
	await panel.start();
	panel.press("nav_mode");
	panel.addPose();
	panel.editPose(0, "x", 3);
	panel.press("pause_resume"); // Start NavigateThroughPoses
	await tick();
	assert.equal(panel.state, "accumulated_nav_through_poses");
	assert.equal(io.goals[0].name, "/navigate_through_poses");
	assert.equal(io.goals[0].goal.poses.goals[0].pose.position.x, 3);
	io.goals[0].onFeedback({ number_of_poses_remaining: 1, distance_remaining: 2 });
	assert.deepEqual(panel.feedback[0], ["Poses remaining:", "1"]);
	io.goals[0].finish("aborted");
	await tick();
	assert.equal(panel.state, "idle");
	assert.equal(panel.goalStatus.text, "aborted");
});

test('helpers: loops, labels, YAML round trip in the RViz panel format', () => {
	assert.deepEqual(checkLoops(""), { ok: true, value: "0" });
	assert.equal(checkLoops("3 ").ok, false);
	assert.equal(checkLoops("99999999999").value, "2147483647");
	assert.equal(goalStatusLabel(5).text, "canceled");
	assert.equal(goalStatusLabel(1).text, "inactive");
	assert.equal(feedbackRows(null, true).length, 7);
	const poses = [{ frame: "map", x: 1.5, y: -2, yaw: Math.PI / 2 }, { frame: "map", x: 0, y: 0, yaw: 0 }];
	const yaml = waypointsToYaml(poses);
	assert.match(yaml, /^waypoints:\n  waypoint0:\n    pose: \[1\.5, -2, 0\]\n    orientation: \[0\.707106781187, 0, 0, 0\.707106781187\]/);
	const back = waypointsFromYaml(yaml);
	assert.equal(back.length, 2);
	assert.ok(Math.abs(back[0].yaw - Math.PI / 2) < 1e-9);
	// the flow style yaml-cpp can also write
	const flow = waypointsFromYaml("waypoints:\n  waypoint0: {pose: [1, 2, 0], orientation: [1, 0, 0, 0]}\n");
	assert.deepEqual([flow[0].x, flow[0].y, flow[0].yaw], [1, 2, 0]);
	assert.equal(waypointMarkers([])[0].markers[0].action, 3);
});

test('Humble / Jazzy: two lifecycle managers, poses as an array, no tracking errors', async () => {
	const io = fakeIo({ managers: ["lifecycle_manager_navigation", "lifecycle_manager_localization"], posesIsArray: true });
	const panel = new Nav2PanelController(io);
	await panel.start();
	assert.equal(panel.state, "idle");
	assert.equal(panel.navigation, "active");
	assert.equal(panel.localization, "active");
	assert.ok(io.calls.some(([name]) => name === "/lifecycle_manager_localization/is_active"));
	// Pause and Resume go to both managers, as the Jazzy panel sends them
	panel.press("pause_resume");
	await tick(); await tick();
	assert.deepEqual(io.calls.filter(([n]) => n.endsWith("/manage_nodes")).map(([n, r]) => [n, r.command]),
		[["/lifecycle_manager_navigation/manage_nodes", LIFECYCLE.PAUSE], ["/lifecycle_manager_localization/manage_nodes", LIFECYCLE.PAUSE]]);
	assert.equal(panel.navigation, "inactive");
	assert.equal(panel.localization, "inactive");
	panel.press("pause_resume");
	await tick(); await tick();
	assert.equal(panel.navigation, "active");
	assert.equal(panel.localization, "active");
	// NavigateThroughPoses: poses is a PoseStamped[]
	panel.press("nav_mode");
	panel.addPose();
	panel.editPose(0, "x", 3);
	panel.press("pause_resume");
	await tick();
	const goal = io.goals[0].goal;
	assert.ok(Array.isArray(goal.poses));
	assert.equal(goal.poses[0].pose.position.x, 3);
	assert.equal(goal.poses[0].header.frame_id, "map");
	// Jazzy's feedback has no tracking errors: their rows go
	io.goals[0].onFeedback({ number_of_poses_remaining: 1, distance_remaining: 2 });
	assert.deepEqual(panel.feedback.map(([label]) => label), ["Poses remaining:", "ETA:", "Distance remaining:", "Time taken:", "Recoveries:"]);
});

test('Cancel: the goal status shows the result Nav2 sends for the cancelled goal', async () => {
	const io = fakeIo();
	const panel = new Nav2PanelController(io);
	await panel.start();
	panel.navToPose = { frame: "map", x: 2, y: 3, yaw: 0 };
	panel.sendNavToPose();
	assert.equal(panel.goalStatus.text, "active");
	panel.press("start_reset"); // Cancel
	assert.equal(io.goals[0].cancelled, true);
	assert.equal(panel.state, "idle");
	io.goals[0].finish("canceled");
	await tick();
	assert.equal(panel.goalStatus.text, "canceled");
	assert.equal(panel.feedback.find(([l]) => l === "Distance remaining:")[1], "0.00 m");
});
