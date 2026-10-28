// The Docking panel (nav2_rviz_plugins/Docking) without the page: its states, what each one
// enables, the DockRobot / UndockRobot goals and the labels. Pure, so it runs under node --test.
import { poseStamped } from './nav2_panel_logic.js';

export const TOOLTIPS = {
	nav_to_staging: "Navigate to the staging pose before docking",
	use_dock_id: "Use the dock id or the dock pose to dock the robot",
	dock: "Dock the robot at the specified docking station",
	undock: "Undock the robot from the docking station",
	cancel_dock: "Cancel the current docking action",
	cancel_undock: "Cancel the current undocking action",
};

// Buttons per state (the QState assignProperty calls). The inputs are enabled once the panel
// leaves pre_initial; which of dock id / dock pose is editable follows the "Dock id" checkbox.
export const DOCK_STATES = {
	pre_initial: { dock: ["Dock robot", false], undock: ["Undock robot", false], inputs: false },
	idle: { dock: ["Dock robot", true, TOOLTIPS.dock], undock: ["Undock robot", true, TOOLTIPS.undock], inputs: true },
	docking: { dock: ["Cancel docking", true, TOOLTIPS.cancel_dock], undock: ["Undock robot", false, TOOLTIPS.undock], inputs: true },
	undocking: { dock: ["Dock robot", false, TOOLTIPS.dock], undock: ["Cancel undocking", true, TOOLTIPS.cancel_undock], inputs: true },
};

// which inputs are enabled (dockIdCheckbox: the pose stays off until the box is first unticked)
export function inputsEnabled(state, useDockId, poseTouched) {
	const on = DOCK_STATES[state].inputs;
	return {
		nav_to_staging: on,
		use_dock_id: on,
		dock_type: on,
		dock_id: on && useDockId,
		pose: on && !useDockId && poseTouched,
	};
}

export function dockStateLabel(state) {
	return ["none", "nav. to staging pose", "initial perception", "controlling", "wait for charge", "retry"][state] ?? "none";
}

export function dockErrorLabel(code) {
	return { 0: "none", 901: "dock not in database", 902: "dock not valid", 903: "failed to stage", 904: "failed to detect dock", 905: "failed to control", 906: "failed to charge" }[code] ?? "unknown";
}

// DockRobot / UndockRobot feedback -> the panel's rows (toLabel)
export function dockFeedbackRows(fb) {
	const t = fb?.docking_time ? fb.docking_time.sec + fb.docking_time.nanosec / 1e9 : 0;
	return [
		["State:", dockStateLabel(fb?.state ?? 0)],
		["Time taken:", `${t.toFixed(0)} s`],
		["Retries:", String(fb?.num_retries ?? 0)],
	];
}

// the result label next to the status: empty on success, "(reason)" otherwise
export function dockResultLabel(result) {
	if (!result || result.success)
		return "";
	return `(${dockErrorLabel(result.error_code)})`;
}

// Types are the docking server's plugins with "Default" first, as the Selector lists them; any
// goal drops "Default" for good (onDockingButtonPressed).
export function dropDefault(types) {
	return types[0] === "Default" ? types.slice(1) : types;
}

// The DockRobot goal, or { error } when the fields do not make one.
// form: { useDockId, navToStaging, dockId, x, y, yaw (strings, as typed), dockType }
export function dockGoal(form, stamp) {
	const goal = { use_dock_id: form.useDockId, navigate_to_staging_pose: form.navToStaging };
	if (form.useDockId) {
		if (!form.dockId)
			return { error: "Dock id is empty." };
		goal.dock_id = form.dockId;
		return { goal };
	}
	if (form.x === "" || form.y === "" || form.yaw === "")
		return { error: "Dock pose is empty." };
	goal.dock_pose = poseStamped({ frame: "map", x: Number(form.x), y: Number(form.y), yaw: Number(form.yaw) }, stamp);
	goal.dock_type = form.dockType;
	return { goal };
}

export function undockGoal(dockType) {
	return { dock_type: dockType };
}
