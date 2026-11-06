// The Nav2 Tools panel without the page: clearing costmaps, Nav2's recovery behaviours, and the
// state of every node the lifecycle managers run. Nothing in RViz does this; the interfaces are
// Nav2's own. Pure, so it runs under node --test.
//
// Humble / Jazzy and Kilted+ differ only in fields this leaves out or reads optionally:
// - behaviour goals: Kilted+ adds disable_collision_checks; left out, it is false (checks on);
// - ClearEntireCostmap: Kilted+ takes plugins[] and answers success; Jazzy takes and answers
//   nothing (an empty request clears every layer in both).

export const CLEAR_TYPE = "nav2_msgs/srv/ClearEntireCostmap";

// "Global costmap cleared." from a ClearEntireCostmap response (Jazzy's has no success field)
export function clearText(label, response) {
	if (response?.success === false)
		return `${label} costmap: Nav2 could not clear it.`;
	return `${label} costmap cleared.`;
}

export function duration(seconds) {
	const s = Math.max(0, Number(seconds) || 0);
	const sec = Math.floor(s);
	return { sec, nanosec: Math.round((s - sec) * 1e9) };
}

const seconds = (d) => (d ? d.sec + d.nanosec / 1e9 : 0);

// The behaviours, as behavior_server offers them. fields: [key, label, unit, default]
export const BEHAVIORS = [
	{ key: "spin", label: "Spin", action: "/spin", type: "nav2_msgs/action/Spin",
		fields: [["angle", "Angle", "°", 90]], help: "Turns in place by the angle (negative: clockwise)." },
	{ key: "backup", label: "Back up", action: "/backup", type: "nav2_msgs/action/BackUp",
		fields: [["distance", "Distance", "m", 0.3], ["speed", "Speed", "m/s", 0.05]], help: "Drives straight backwards." },
	{ key: "drive", label: "Drive on heading", action: "/drive_on_heading", type: "nav2_msgs/action/DriveOnHeading",
		fields: [["distance", "Distance", "m", 0.3], ["speed", "Speed", "m/s", 0.05]], help: "Drives straight ahead." },
	{ key: "wait", label: "Wait", action: "/wait", type: "nav2_msgs/action/Wait",
		fields: [["time", "Time", "s", 5]], help: "Stands still." },
	{ key: "assisted_teleop", label: "Assisted teleop", action: "/assisted_teleop", type: "nav2_msgs/action/AssistedTeleop",
		fields: [["time", "Time", "s", 30]], help: "Drives by the teleop velocity, stopping short of obstacles." },
];

export const behavior = (key) => BEHAVIORS.find((b) => b.key === key);

// The goal for a behaviour. values: { field: number }; timeLimit: seconds for the behaviours that
// take a time allowance (0: no limit, as Nav2 reads it)
export function behaviorGoal(key, values, timeLimit = 10) {
	const allowance = duration(timeLimit);
	switch (key) {
		case "spin":
			return { target_yaw: (Number(values.angle) || 0) * Math.PI / 180, time_allowance: allowance };
		case "backup":
		case "drive":
			// both take a positive distance; BackUp turns it backwards itself
			return { target: { x: Math.abs(Number(values.distance) || 0), y: 0, z: 0 }, speed: Math.abs(Number(values.speed) || 0), time_allowance: allowance };
		case "wait":
			return { time: duration(values.time) };
		case "assisted_teleop":
			return { time_allowance: duration(values.time) };
	}
	throw new Error(`Unknown behaviour ${key}`);
}

// What a behaviour is doing, from its feedback: "Spin: 45° turned"
export function behaviorFeedbackText(key, fb) {
	if (!fb)
		return "";
	switch (key) {
		case "spin": return `${Math.round((fb.angular_distance_traveled ?? 0) * 180 / Math.PI)}° turned`;
		case "backup":
		case "drive": return `${(fb.distance_traveled ?? 0).toFixed(2)} m driven`;
		case "wait": return `${seconds(fb.time_left).toFixed(1)} s left`;
		case "assisted_teleop": return `${seconds(fb.current_teleop_duration).toFixed(1)} s of teleop`;
	}
	return "";
}

const ERRORS = {
	700: "unknown error", 701: "out of time", 702: "transform error", 703: "collision ahead",
	710: "unknown error", 711: "out of time", 712: "transform error", 713: "invalid input", 714: "collision ahead",
	720: "unknown error", 721: "out of time", 722: "transform error", 723: "collision ahead", 724: "invalid input",
	730: "unknown error", 731: "out of time", 732: "transform error",
	740: "unknown error", 741: "out of time",
	1: "goal rejected", 2: "goal could not be sent",
};

// The line shown when a behaviour ends. result: the action client's { status, values, ok }
export function behaviorResultText(label, { status, values, ok }) {
	if (!ok)
		return `${label}: ${values}`;
	const elapsed = values?.total_elapsed_time ? ` after ${seconds(values.total_elapsed_time).toFixed(1)} s` : "";
	if (status === "succeeded")
		return `${label}: done${elapsed}.`;
	if (status === "canceled")
		return `${label}: cancelled${elapsed}.`;
	const code = values?.error_code;
	const why = values?.error_msg || ERRORS[code] || (code ? `error ${code}` : "");
	return `${label}: ${status ?? "failed"}${why ? ` (${why})` : ""}${elapsed}.`;
}

// ---- lifecycle ----

// rcl_interfaces/srv/GetParameters response for ["node_names"] -> the managed node names
export function nodeNames(response) {
	const value = response?.values?.[0];
	if (!value || value.type !== 9) // PARAMETER_STRING_ARRAY
		return [];
	return [...(value.string_array_value ?? [])];
}

// lifecycle_msgs/msg/State ids
const STATE = {
	0: ["unknown", null], 1: ["unconfigured", "grey"], 2: ["inactive", "orange"], 3: ["active", "green"], 4: ["finalized", "red"],
	10: ["configuring", "blue"], 11: ["cleaning up", "blue"], 12: ["shutting down", "blue"], 13: ["activating", "blue"],
	14: ["deactivating", "blue"], 15: ["error processing", "red"],
};

// lifecycle_msgs/srv/GetState response -> { text, color }; null response: the node did not answer
export function stateLabel(response) {
	if (!response)
		return { text: "not answering", color: "red" };
	const state = response.current_state ?? {};
	const [text, color] = STATE[state.id] ?? [state.label || "unknown", null];
	return { text, color };
}

// one line per manager: "lifecycle_manager_navigation: 10 of 11 active"
export function managerSummary(manager, states) {
	const active = states.filter((s) => s.text === "active").length;
	return `${manager}: ${active} of ${states.length} active`;
}

// ---- plan without driving ----

export const COMPUTE_PATH = { action: "/compute_path_to_pose", type: "nav2_msgs/action/ComputePathToPose" };
export const FOLLOW_PATH = { action: "/follow_path", type: "nav2_msgs/action/FollowPath" };
export const PLAN_TOPIC = "/nav2_tools/plan";

// The ComputePathToPose goal from the robot (use_start false: the planner finds it in TF) to
// x, y, yaw (degrees) in `frame`. Kilted+ also takes viapoints; left out, there are none.
export function planGoal({ x, y, yaw = 0, plannerId = "" }, frame = "map", stamp = { sec: 0, nanosec: 0 }) {
	const nx = Number(x);
	const ny = Number(y);
	if (String(x ?? "").trim() === "" || String(y ?? "").trim() === "" || !Number.isFinite(nx) || !Number.isFinite(ny))
		return { error: "The goal needs an X and a Y (Publish Point fills them)." };
	const a = ((Number(yaw) || 0) * Math.PI) / 180;
	const pose = { header: { frame_id: frame, stamp }, pose: { position: { x: nx, y: ny, z: 0 }, orientation: { x: 0, y: 0, z: Math.sin(a / 2), w: Math.cos(a / 2) } } };
	return { goal: { goal: pose, planner_id: plannerId, use_start: false } };
}

function pathLength(path) {
	const poses = path?.poses ?? [];
	let length = 0;
	for (let i = 1; i < poses.length; i++) {
		const a = poses[i - 1].pose.position;
		const b = poses[i].pose.position;
		length += Math.hypot(b.x - a.x, b.y - a.y);
	}
	return length;
}

// "Path: 3.21 m, 64 poses, planned in 0.05 s"
export function planSummary(values) {
	const poses = values?.path?.poses?.length ?? 0;
	return `Path: ${pathLength(values?.path).toFixed(2)} m, ${poses} poses, planned in ${seconds(values?.planning_time).toFixed(2)} s`;
}

const PLAN_ERRORS = {
	1: "the planner rejected the goal", 2: "the goal could not be sent",
	200: "unknown error", 201: "no such planner", 202: "the robot or the goal could not be found in TF",
	203: "the robot is outside the map", 204: "the goal is outside the map", 205: "the robot is in an occupied cell",
	206: "the goal is in an occupied cell", 207: "the planner ran out of time", 208: "there is no valid path",
};

// the plain words for a known code (Kilted+ also sends a long technical error_msg); Nav2's own
// message only for codes not known here
export function planErrorText(values) {
	const known = values?.error_code !== 200 ? PLAN_ERRORS[values?.error_code] : null;
	return known || values?.error_msg || PLAN_ERRORS[values?.error_code] || `error ${values?.error_code ?? "?"}`;
}

// ---- save the map ----

export const SAVE_MAP = { service: "/map_saver/save_map", type: "nav2_msgs/srv/SaveMap" };

// nav2_msgs/srv/SaveMap request: the map on `topic` to <path>.<format> and <path>.yaml on the
// robot (the map saver's own defaults for the rest)
export function saveMapRequest({ path, format = "pgm", mode = "trinary", topic = "/map" }) {
	const url = String(path ?? "").trim().replace(/\.(pgm|png|bmp|yaml)$/i, "");
	if (!url)
		return { error: "Give the path to save to, on the robot (without an extension)." };
	return { request: { map_topic: topic, map_url: url, image_format: format, map_mode: mode, free_thresh: 0.25, occupied_thresh: 0.65 } };
}

export function saveMapText(response, request) {
	if (response?.result)
		return `Saved ${request.map_url}.${request.image_format} and ${request.map_url}.yaml on the robot.`;
	return `The map saver could not save ${request.map_url} (is ${request.map_topic} published, and the folder writable?).`;
}

// the service is missing: the map saver runs with SLAM (nav2_bringup slam:=True) or on its own
export const NO_MAP_SAVER = "No map saver is running. It runs with SLAM (nav2_bringup slam:=True), or start it: ros2 run nav2_map_server map_saver_server, then configure and activate it.";

const FOLLOW_ERRORS = {
	1: "the controller rejected the path", 2: "the path could not be sent",
	100: "unknown error", 101: "no such controller", 102: "transform error", 103: "the path is invalid",
	104: "patience exceeded", 105: "the robot made no progress", 106: "no valid control command",
	107: "the controller timed out", 108: "it took too long",
};

// FollowPath's result, in words (Jazzy leaves error_msg empty)
export function followErrorText(values) {
	const known = values?.error_code !== 100 ? FOLLOW_ERRORS[values?.error_code] : null;
	return known || values?.error_msg || FOLLOW_ERRORS[values?.error_code] || `error ${values?.error_code ?? "?"}`;
}
