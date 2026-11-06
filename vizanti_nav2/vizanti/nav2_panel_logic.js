// The Navigation 2 panel's behaviour, ported from nav2_rviz_plugins' Nav2Panel (nav2_panel.cpp):
// the same states, button texts, tooltips, enabled flags, transitions and side effects. No DOM
// and no ROS here: the controller talks to ROS through `io` and to the page through onChange.

import { ntpGoal } from './nav2_compat.js';

const STARTUP = "Configure and activate all nav2 lifecycle nodes";
const SHUTDOWN = "Deactivate and cleanup all nav2 lifecycle nodes";
const CANCEL = "Cancel navigation";
const PAUSE = "Deactivate all nav2 lifecycle nodes";
const RESUME = "Activate all nav2 lifecycle nodes";
const SINGLE_GOAL = "Change to waypoint Following / nav through poses style navigation";
const WAYPOINT_GOAL = "Start following waypoints";
const NTP_GOAL = "Start navigating through poses";
const CANCEL_WAYPOINT = "Cancel waypoint / viapoint accumulation mode";
const MODE = "Waypoint Following / NavigateThroughPoses Mode";
const PAUSE_WP = "Pause Waypoint Following";

// nav2_msgs/srv/ManageLifecycleNodes commands
export const LIFECYCLE = { STARTUP: 0, PAUSE: 1, RESUME: 2, RESET: 3, SHUTDOWN: 4 };

const b = (text, enabled, tip = "") => ({ text, enabled, tip });

// What each state shows. `null` for a control: that state leaves it as it was (Qt's
// assignProperty only touches the properties a state names).
export const UI_STATES = {
	pre_initial: {
		start_reset: b("Startup", false), pause_resume: b("Pause", false), nav_mode: b(MODE, false),
		add_pose: false, remove_pose: false, save: false, load: false, pause_wp: b(PAUSE_WP, false),
		loops: { text: "0", enabled: false }, store_initial: false, start_nav_to_pose: null,
	},
	initial: {
		start_reset: b("Startup", true, STARTUP), pause_resume: b("Pause", false), nav_mode: b(MODE, false),
		add_pose: false, remove_pose: false, save: false, load: false, pause_wp: b(PAUSE_WP, false),
		loops: { text: "0", enabled: false }, store_initial: false, start_nav_to_pose: null,
	},
	idle: {
		start_reset: b("Reset", true, SHUTDOWN), pause_resume: b("Pause", true, PAUSE), nav_mode: b(MODE, true, SINGLE_GOAL),
		add_pose: false, remove_pose: false, save: false, load: false, pause_wp: b(PAUSE_WP, false),
		loops: { text: "0", enabled: false }, store_initial: false, start_nav_to_pose: true,
	},
	accumulating: {
		start_reset: b("Cancel Accumulation", true, CANCEL_WAYPOINT), pause_resume: b("Start NavigateThroughPoses", true, NTP_GOAL),
		nav_mode: b("Start Waypoint Following", true, WAYPOINT_GOAL),
		add_pose: true, remove_pose: true, save: true, load: true, pause_wp: b(PAUSE_WP, false),
		loops: { text: "loop_no", enabled: true }, store_initial: true, start_nav_to_pose: null,
	},
	accumulated_wp: {
		start_reset: b("Cancel", true, CANCEL), pause_resume: b("Start NavigateThroughPoses", false, NTP_GOAL),
		nav_mode: b("Start Waypoint Following", false, WAYPOINT_GOAL),
		add_pose: false, remove_pose: false, save: false, load: false, pause_wp: b(PAUSE_WP, true),
		loops: { text: "loop_no", enabled: false }, store_initial: false, start_nav_to_pose: null,
	},
	accumulated_nav_through_poses: {
		start_reset: b("Cancel", true, CANCEL), pause_resume: b("Start NavigateThroughPoses", false, NTP_GOAL),
		nav_mode: b("Start Waypoint Following", false, WAYPOINT_GOAL),
		add_pose: false, remove_pose: false, save: false, load: false, pause_wp: b(PAUSE_WP, false),
		loops: { text: "loop_no", enabled: false }, store_initial: false, start_nav_to_pose: null,
	},
	running: {
		start_reset: b("Cancel", true, CANCEL), pause_resume: b("Pause", false), nav_mode: b(MODE, false),
		add_pose: false, remove_pose: false, save: false, load: false, pause_wp: b(PAUSE_WP, false),
		loops: { text: "0", enabled: false }, store_initial: false, start_nav_to_pose: false,
	},
	paused: {
		start_reset: b("Reset", true, SHUTDOWN), pause_resume: b("Resume", true, RESUME), nav_mode: b("", false),
		add_pose: false, remove_pose: false, save: false, load: false, pause_wp: b(PAUSE_WP, false),
		loops: { text: null, enabled: false }, store_initial: false, start_nav_to_pose: false,
	},
	resumed_wp: {
		start_reset: b("Cancel", true, CANCEL), pause_resume: b("Start NavigateThroughPoses", false), nav_mode: b("Start Waypoint Following", false),
		add_pose: false, remove_pose: false, save: true, load: false, pause_wp: b("Resume WaypointFollowing", true),
		loops: { text: null, enabled: false }, store_initial: false, start_nav_to_pose: null,
	},
};

// button -> next state, per state (the Qt signal transitions)
export const TRANSITIONS = {
	initial: { start_reset: "idle" },
	idle: { start_reset: "reset", nav_mode: "accumulating", pause_resume: "paused" },
	running: { start_reset: "canceled" },
	paused: { start_reset: "reset", pause_resume: "resumed" },
	accumulating: { nav_mode: "accumulated_wp", pause_resume: "accumulated_nav_through_poses", start_reset: "idle" },
	accumulated_wp: { start_reset: "canceled", pause_wp: "resumed_wp" },
	accumulated_nav_through_poses: { start_reset: "canceled" },
	resumed_wp: { pause_wp: "accumulated_wp", start_reset: "canceled" },
};

// states that pass straight on to another once entered
const PASS_THROUGH = { canceled: "idle", reset: "initial", resumed: "idle" };

export function yawToQuaternion(yaw) {
	return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

export function quaternionToYaw(q) {
	return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
}

// {frame, x, y, yaw} -> geometry_msgs/PoseStamped
export function poseStamped(p, stamp = { sec: 0, nanosec: 0 }) {
	return {
		header: { frame_id: p.frame, stamp },
		pose: { position: { x: p.x, y: p.y, z: p.z ?? 0 }, orientation: p.orientation ?? yawToQuaternion(p.yaw) },
	};
}

// the panel's loop field: { ok, value, note } (isLoopValueValid)
export function checkLoops(text) {
	const value = String(text ?? "");
	if (value === "")
		return { ok: true, value: "0" };
	if (!/^[0-9]+$/.test(value))
		return { ok: false, value, note: "Set a valid value for the loop" };
	if (Number(value) > 2147483647)
		return { ok: true, value: "2147483647", note: "Loop value out of range, setting max possible value" };
	return { ok: true, value: String(Number(value)) };
}

// "Feedback: active" etc. (nav2_rviz_plugins::getGoalStatusLabel)
export function goalStatusLabel(status, title = "Feedback") {
	const text = { 2: ["active", "green"], 4: ["reached", "green"], 5: ["canceled", "orange"], 6: ["aborted", "red"], 0: ["unknown", null] }[status] ?? ["inactive", null];
	return { title, text: text[0], color: text[1] };
}

const seconds = (d) => (d ? d.sec + d.nanosec / 1e9 : 0);

// The feedback table rows (toLabel); NavigateThroughPoses adds "Poses remaining" first.
// tracking: show the position / heading tracking errors (Kilted and later; Jazzy's feedback has
// no such fields, and its panel no such rows).
export function feedbackRows(fb, throughPoses = false, tracking = true) {
	if (!fb)
		fb = { estimated_time_remaining: null, distance_remaining: 0, position_tracking_error: 0, heading_tracking_error: 0, navigation_time: null, number_of_recoveries: 0, number_of_poses_remaining: 0 };
	const rows = [];
	if (throughPoses)
		rows.push(["Poses remaining:", String(fb.number_of_poses_remaining ?? 0)]);
	rows.push(
		["ETA:", `${seconds(fb.estimated_time_remaining).toFixed(0)} s`],
		["Distance remaining:", `${(fb.distance_remaining ?? 0).toFixed(2)} m`],
	);
	if (tracking)
		rows.push(
			["Position error:", `${(fb.position_tracking_error ?? 0).toFixed(2)} m`],
			["Heading error:", `${(fb.heading_tracking_error ?? 0).toFixed(2)} rad`],
		);
	rows.push(
		["Time taken:", `${seconds(fb.navigation_time).toFixed(0)} s`],
		["Recoveries:", String(fb.number_of_recoveries ?? 0)],
	);
	return rows;
}

// The waypoint markers the panel publishes on "waypoints" (updateWpNavigationMarkers):
// a DELETEALL array, then an arrow, a sphere and "wp_N" per pose.
export function waypointMarkers(poses, stamp = { sec: 0, nanosec: 0 }) {
	const clear = { markers: [{ action: 3, header: { frame_id: "", stamp }, ns: "", id: 0 }] };
	const markers = [];
	let id = 0;
	const base = (p, type, scale, color) => ({
		header: { frame_id: p.frame, stamp }, ns: "", id: id++, type, action: 0,
		pose: poseStamped(p).pose, scale, color, lifetime: { sec: 0, nanosec: 0 }, frame_locked: false,
		points: [], colors: [], text: "", mesh_resource: "", mesh_use_embedded_materials: false,
	});
	poses.forEach((p, i) => {
		markers.push(base(p, 0, { x: 0.3, y: 0.05, z: 0.02 }, { r: 0, g: 1, b: 0, a: 1 }));
		markers.push(base(p, 2, { x: 0.05, y: 0.05, z: 0.05 }, { r: 1, g: 0, b: 0, a: 1 }));
		const text = base(p, 9, { x: 0.07, y: 0.07, z: 0.07 }, { r: 0, g: 1, b: 0, a: 1 });
		text.pose.position.z += 0.2;
		text.text = `wp_${i + 1}`;
		markers.push(text);
	});
	return [clear, { markers }];
}

// Saved waypoints, the format the RViz panel writes (handleGoalSaver):
// waypoints: { waypoint0: { pose: [x, y, z], orientation: [w, x, y, z] }, ... }
export function waypointsToYaml(poses) {
	const n = (v) => (Number.isInteger(v) ? String(v) : String(Number(v.toFixed(12))));
	const lines = ["waypoints:"];
	poses.forEach((p, i) => {
		const q = p.orientation ?? yawToQuaternion(p.yaw);
		lines.push(`  waypoint${i}:`);
		lines.push(`    pose: [${[p.x, p.y, p.z ?? 0].map(n).join(", ")}]`);
		lines.push(`    orientation: [${[q.w, q.x, q.y, q.z].map(n).join(", ")}]`);
	});
	return lines.join("\n") + "\n";
}

// handleGoalLoader: poses in "map", in the file's order. Accepts the block and flow styles.
export function waypointsFromYaml(text) {
	const out = [];
	const numbers = (s) => s.replace(/[[\]\s]/g, "").split(",").filter(Boolean).map(Number);
	let current = null;
	for (const raw of String(text).split(/\r?\n/)) {
		const line = raw.replace(/#.*$/, "");
		const head = /^\s+(\w+)\s*:\s*(\{.*\})?\s*$/.exec(line);
		if (head && head[1] !== "pose" && head[1] !== "orientation") {
			current = { pose: null, orientation: null };
			out.push(current);
			if (head[2]) {
				const pose = /pose\s*:\s*(\[[^\]]*\])/.exec(head[2]);
				const orientation = /orientation\s*:\s*(\[[^\]]*\])/.exec(head[2]);
				current.pose = pose ? numbers(pose[1]) : null;
				current.orientation = orientation ? numbers(orientation[1]) : null;
			}
			continue;
		}
		const field = /^\s+(pose|orientation)\s*:\s*(\[[^\]]*\])/.exec(line);
		if (field && current)
			current[field[1]] = numbers(field[2]);
	}
	return out
		.filter((w) => w.pose?.length === 3 && w.orientation?.length === 4 && [...w.pose, ...w.orientation].every(Number.isFinite))
		.map((w) => {
			const [qw, qx, qy, qz] = w.orientation;
			const orientation = { x: qx, y: qy, z: qz, w: qw };
			return { frame: "map", x: w.pose[0], y: w.pose[1], z: w.pose[2], yaw: quaternionToYaw(orientation), orientation };
		});
}

// The panel. io: {
//   action(name, type) -> { send(goal, { onFeedback }) -> { result, cancel() } },
//   callService(name, type, request, timeoutMs) -> Promise,
//   publishMarkers(markerArray), lookupBasePose(frame) -> {x, y, z, orientation} | null,
//   now() -> {sec, nanosec}, managers() -> Promise<[node names]> (the first is "Navigation:"),
//   ntpPosesIsArray() -> Promise<bool> (see nav2_compat.js), baseFrame(), notify(text),
//   name(n) -> n in the Nav2 namespace (optional) }
export class Nav2PanelController {

	constructor(io, onChange = () => {}) {
		this.io = io;
		this.onChange = onChange;
		this.state = "pre_initial";
		this.ui = structuredClone(UI_STATES.pre_initial);
		this.loopNo = "0";
		this.loopCount = 0;
		this.goalIndex = 0;
		this.loopCounterStop = true;
		this.storeInitialPose = false;
		this.initialPoseStored = false;
		this.accumulated = []; // {frame, x, y, yaw, z?, orientation?}
		this.store = [];
		this.bt = "";
		this.navToPose = { frame: "map", x: 0, y: 0, yaw: 0 };
		this.tabs = { navToPose: false, waypoints: false, current: "navToPose" };
		this.navigation = "unknown"; // Navigation: active | inactive | unknown
		this.localization = null; // Localization: shown when a second manager runs it (Jazzy)
		this.managers = [];
		this.tracking = true; // the feedback has tracking errors (cleared by one that has not)
		this.goalStatus = goalStatusLabel(-1);
		this.feedback = feedbackRows(null, true, this.tracking);
		this.waypointNote = "";
		this.goals = { nav: null, wp: null, ntp: null };
		this.cancelled = new Set(); // goals cancelled from the panel, until their result arrives
		this.applyUi("pre_initial");
	}

	snapshot() {
		return {
			state: this.state, ui: this.ui, navigation: this.navigation, localization: this.localization, goalStatus: this.goalStatus,
			feedback: this.feedback, waypointNote: this.waypointNote, accumulated: this.accumulated,
			tabs: this.tabs, navToPose: this.navToPose, bt: this.bt, storeInitialPose: this.storeInitialPose,
		};
	}

	changed() {
		this.onChange(this.snapshot());
	}

	applyUi(state) {
		const target = UI_STATES[state];
		if (!target)
			return;
		for (const [key, value] of Object.entries(target)) {
			if (value === null)
				continue;
			if (key === "loops") {
				if (value.text !== null)
					this.ui.loops.text = value.text === "loop_no" ? this.loopNo : value.text;
				this.ui.loops.enabled = value.enabled;
			} else {
				this.ui[key] = typeof value === "object" ? { ...value } : value;
			}
		}
	}

	// ---- startup: is navigation already active? (InitialThread) ----

	async start() {
		this.stopped = false;
		while (!this.stopped && this.state === "pre_initial") {
			let active = null;
			try {
				this.managers = await this.io.managers();
				const [navigation, localization] = await Promise.all(this.managers.map((m) => this.isActive(m)));
				active = navigation;
				if (this.managers.length > 1)
					this.localization = localization === null ? "unknown" : (localization ? "active" : "inactive");
			} catch (e) {
				active = null; // not answering yet: ask again, as the RViz panel does
			}
			if (this.stopped)
				return;
			if (active === null) {
				await new Promise((r) => setTimeout(r, 1000));
				continue;
			}
			this.navigation = active ? "active" : "inactive";
			if (!active) {
				this.goalStatus = goalStatusLabel(-1);
				this.feedback = feedbackRows(null, true, this.tracking);
			}
			this.enter(active ? "idle" : "initial");
		}
	}

	// a Nav2 name in the panel's namespace (io.name; none: as given)
	name(n) {
		return this.io.name ? this.io.name(n) : n;
	}

	async isActive(manager) {
		try {
			const response = await this.io.callService(`/${manager}/is_active`, "std_srvs/srv/Trigger", {}, 1500);
			return !!response.success;
		} catch (e) {
			return null;
		}
	}

	stop() {
		this.stopped = true;
	}

	// ---- buttons ----

	press(button) {
		const target = TRANSITIONS[this.state]?.[button];
		if (!target || this.ui[button]?.enabled === false)
			return;
		this.go(target);
	}

	go(target) {
		this.exit(this.state);
		this.enter(target);
	}

	exit(state) {
		if (state === "initial")
			this.lifecycle(LIFECYCLE.STARTUP);
	}

	enter(state) {
		this.state = state;
		this.applyUi(state);
		switch (state) {
			case "idle": this.onIdle(); break;
			case "accumulating": this.onAccumulating(); break;
			case "accumulated_wp": this.onAccumulatedWp(); break;
			case "accumulated_nav_through_poses": this.onAccumulatedNTP(); break;
			case "resumed_wp": this.onResumedWp(); break;
			case "paused": this.lifecycle(LIFECYCLE.PAUSE); break;
		}
		const next = PASS_THROUGH[state];
		if (next) {
			// the side effect happens as the pass-through state is left (Qt's exited())
			if (state === "canceled")
				this.onCancel();
			else if (state === "reset")
				this.lifecycle(LIFECYCLE.RESET);
			else if (state === "resumed")
				this.lifecycle(LIFECYCLE.RESUME);
			this.enter(next);
			return;
		}
		this.changed();
	}

	// an action went active or inactive (ROSActionQTransition)
	actionEvent(active) {
		if (active && this.state === "idle")
			this.enter("running");
		else if (!active && ["running", "accumulated_wp", "accumulated_nav_through_poses"].includes(this.state))
			this.enter("idle");
	}

	// every manager gets the command, as the Jazzy panel sends it to navigation and localization
	async lifecycle(command) {
		const managers = this.managers.length > 0 ? this.managers : await this.io.managers();
		const results = await Promise.all(managers.map(async (manager) => {
			try {
				const response = await this.io.callService(`/${manager}/manage_nodes`, "nav2_msgs/srv/ManageLifecycleNodes", { command }, 30000);
				return !!response.success;
			} catch (e) {
				this.io.notify?.(`The Nav2 lifecycle manager ${manager} did not answer: ${e.message}`);
				return null;
			}
		}));
		const up = command === LIFECYCLE.STARTUP || command === LIFECYCLE.RESUME;
		const label = (ok, before) => (ok ? (up ? "active" : "inactive") : before);
		this.navigation = label(results[0], this.navigation);
		if (managers.length > 1)
			this.localization = label(results[1], this.localization);
		this.changed();
	}

	// ---- state entry actions ----

	onIdle() {
		this.tabs = { navToPose: true, waypoints: false, current: "navToPose" };
	}

	onAccumulating() {
		this.accumulated = [];
		this.store = [];
		this.loopCount = 0;
		this.loopNo = "0";
		this.ui.loops.text = "0";
		this.initialPoseStored = false;
		this.loopCounterStop = true;
		this.goalIndex = 0;
		this.publishMarkers();
		this.navToPose = { frame: "map", x: 0, y: 0, yaw: 0 };
		this.tabs = { navToPose: false, waypoints: true, current: "waypoints" };
	}

	onAccumulatedWp() {
		if (this.accumulated.length === 0) {
			this.waypointNote = "Uh oh! Someone forgot to select the waypoints";
			this.actionEvent(false);
			return;
		}
		const loops = checkLoops(this.loopNo);
		if (!loops.ok) {
			this.waypointNote = loops.note;
			this.actionEvent(false);
			return;
		}
		this.loopNo = loops.value;
		this.waypointNote = "";
		this.ui.nav_mode.enabled = false;
		this.ui.pause_resume.enabled = false;
		if (this.store.length === 0) {
			this.ui.loops.text = this.loopNo;
			if (this.storeInitialPose) {
				const base = this.io.lookupBasePose(this.accumulated[0].frame);
				if (!base) {
					this.io.notify?.(`Could not transform ${this.accumulated[0].frame} to ${this.io.baseFrame()}.`);
					return;
				}
				this.accumulated.unshift({ frame: this.accumulated[0].frame, x: base.x, y: base.y, z: base.z, yaw: quaternionToYaw(base.orientation), orientation: base.orientation });
				this.publishMarkers();
				this.initialPoseStored = true;
				if (this.loopCount === 0)
					this.goalIndex = 1;
			}
		}
		this.startWaypointFollowing(this.accumulated);
		this.store = this.accumulated.map((p) => ({ ...p }));
	}

	onAccumulatedNTP() {
		this.startNavThroughPoses(this.accumulated);
	}

	onResumedWp() {
		this.cancelGoals();
		this.accumulated = this.store.map((p) => ({ ...p }));
		this.loopNo = String(Number(this.ui.loops.text || 0) - this.loopCount);
		this.waypointNote = "Navigation is paused.";
	}

	onCancel() {
		this.cancelGoals();
		this.waypointNote = "";
		this.store = [];
		this.accumulated = [];
	}

	cancelGoals() {
		for (const key of Object.keys(this.goals)) {
			if (this.goals[key]) {
				this.cancelled.add(this.goals[key]);
				this.goals[key].cancel();
			}
			this.goals[key] = null;
		}
	}

	// ---- goals ----

	// from the Nav2 goal tool (onNewGoal)
	newGoal(pose) {
		if (this.store.length === 0) {
			if (this.state === "accumulating") {
				this.waypointNote = "";
				this.accumulated.push({ ...pose });
			} else {
				this.accumulated = [];
				this.startNavigation(pose);
			}
		} else {
			this.waypointNote = "Cannot set goal in pause state";
		}
		this.publishMarkers();
		this.changed();
	}

	sendNavToPose() {
		if (!this.ui.start_nav_to_pose)
			return;
		this.startNavigation({ ...this.navToPose });
	}

	run(key, name, type, goal, onFeedback) {
		const handle = this.io.action(name, type).send(goal, { onFeedback });
		this.goals[key] = handle;
		this.goalStatus = goalStatusLabel(2);
		this.actionEvent(true);
		this.changed();
		handle.result.then(({ status, values, ok }) => {
			const code = { succeeded: 4, canceled: 5, aborted: 6 }[status] ?? (ok ? -1 : 0);
			if (this.goals[key] !== handle) {
				// cancelled from the panel: the state moved on already, the status still shows it
				if (this.cancelled.delete(handle)) {
					this.goalStatus = goalStatusLabel(code);
					this.feedback = feedbackRows(null, key === "ntp", this.tracking);
					this.changed();
				}
				return; // or replaced by a newer goal
			}
			this.goals[key] = null;
			this.goalStatus = goalStatusLabel(code);
			if (!ok)
				this.io.notify?.(`${name}: ${values}`);
			if (key === "nav")
				this.navToPose = { frame: "map", x: 0, y: 0, yaw: 0 };
			else {
				this.accumulated = [];
				this.publishMarkers();
			}
			if (key === "wp" && code === 4) {
				// the last waypoint of the last loop reached
				this.store = [];
				this.waypointNote = "";
				this.loopNo = "0";
				this.loopCount = 0;
			}
			this.feedback = feedbackRows(null, key === "ntp", this.tracking);
			this.actionEvent(false);
			this.changed();
		});
		return handle;
	}

	startNavigation(pose) {
		this.run("nav", this.name("/navigate_to_pose"), "nav2_msgs/action/NavigateToPose",
			{ pose: poseStamped(pose, this.io.now()), behavior_tree: this.bt },
			(fb) => this.onNavFeedback(fb));
	}

	startWaypointFollowing(poses) {
		const stamp = this.io.now();
		this.run("wp", this.name("/follow_waypoints"), "nav2_msgs/action/FollowWaypoints",
			{ poses: poses.map((p) => poseStamped(p, stamp)), goal_index: this.goalIndex, number_of_loops: Number(this.loopNo) },
			(fb) => {
				this.goalIndex = fb.current_waypoint;
			});
	}

	async startNavThroughPoses(poses) {
		const stamp = this.io.now();
		let posesIsArray = false;
		try {
			posesIsArray = await this.io.ntpPosesIsArray();
		} catch (e) {
			// rosapi did not answer: the newer form, as before
		}
		this.run("ntp", this.name("/navigate_through_poses"), "nav2_msgs/action/NavigateThroughPoses",
			ntpGoal(poses.map((p) => poseStamped(p, stamp)), poses[0]?.frame ?? "map", stamp, this.bt, posesIsArray),
			(fb) => {
				this.feedback = feedbackRows(fb, true, this.hasTracking(fb));
				this.changed();
			});
	}

	hasTracking(fb) {
		if (fb && !("position_tracking_error" in fb))
			this.tracking = false;
		return this.tracking;
	}

	// NavigateToPose feedback, also while following waypoints (the follower drives it)
	onNavFeedback(fb) {
		const rows = feedbackRows(fb, false, this.hasTracking(fb));
		if (Number(this.ui.loops.text) > 0) {
			if (this.goalIndex === 0 && !this.loopCounterStop) {
				this.loopCount++;
				this.loopCounterStop = true;
			}
			if (this.goalIndex !== 0)
				this.loopCounterStop = false;
			rows.push(["Waypoint:", String(this.goalIndex + 1)], ["Loop:", String(this.loopCount)]);
		}
		this.feedback = rows;
		this.changed();
	}

	// ---- waypoint editing ----

	setLoops(text) {
		const loops = checkLoops(text);
		this.loopNo = loops.value;
		this.ui.loops.text = loops.value;
		if (!loops.ok) {
			this.waypointNote = loops.note;
			this.ui.nav_mode.enabled = false;
		} else {
			if (loops.note)
				this.waypointNote = loops.note;
			this.ui.nav_mode.enabled = true;
			this.ui.pause_resume.enabled = !(Number(loops.value) > 0);
		}
		this.changed();
	}

	addPose() {
		this.accumulated.push({ frame: "map", x: 0, y: 0, yaw: 0 });
		this.publishMarkers();
		this.changed();
	}

	removePose(index) {
		if (index >= 0 && index < this.accumulated.length) {
			this.accumulated.splice(index, 1);
			this.publishMarkers();
			this.changed();
		}
	}

	editPose(index, field, value) {
		const pose = this.accumulated[index];
		if (!pose)
			return;
		pose[field] = value;
		delete pose.orientation; // the yaw field decides it now
		pose.z = 0;
		this.publishMarkers();
		this.changed();
	}

	loadWaypoints(yamlText) {
		const poses = waypointsFromYaml(yamlText);
		this.accumulated.push(...poses);
		this.publishMarkers();
		this.changed();
		return poses.length;
	}

	saveWaypoints() {
		return this.accumulated.length ? waypointsToYaml(this.accumulated) : null;
	}

	publishMarkers() {
		for (const array of waypointMarkers(this.accumulated, this.io.now()))
			this.io.publishMarkers(array);
	}
}
