// The Nav2 Tools panel without the page: clearing costmaps, Nav2's recovery behaviours, and the
// state of every node the lifecycle managers run. Nothing in RViz does this; the interfaces are
// Nav2's own. Pure, so it runs under node --test.
//
// Humble / Jazzy and Kilted+ differ only in fields this leaves out or reads optionally:
// - behaviour goals: Kilted+ adds disable_collision_checks; left out, it is false (checks on);
// - ClearEntireCostmap: Kilted+ takes plugins[] and answers success; Jazzy takes and answers
//   nothing (an empty request clears every layer in both).

export const CLEAR_COSTMAPS = [
	["global", "Global", "/global_costmap/clear_entirely_global_costmap"],
	["local", "Local", "/local_costmap/clear_entirely_local_costmap"],
].map(([key, label, service]) => ({ key, label, service }));

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

// a node name as a service prefix: "controller_server" -> "/controller_server"
export function nodePath(name) {
	return name.startsWith("/") ? name : `/${name}`;
}

// one line per manager: "lifecycle_manager_navigation: 10 of 11 active"
export function managerSummary(manager, states) {
	const active = states.filter((s) => s.text === "active").length;
	return `${manager}: ${active} of ${states.length} active`;
}
