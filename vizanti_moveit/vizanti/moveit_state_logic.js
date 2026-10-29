// MoveIt robot states without the page: default joint values, moveit_msgs/RobotState applied to
// them, and DisplayRobotState highlights. Pure (no imports), so it runs under node --test.

// the joints a joint state names: movable and not mimicking another (kinematics.js movableJoints)
export function movableJoints(robot) {
	return Object.entries(robot.joints)
		.filter(([, j]) => !j.mimic && ["revolute", "continuous", "prismatic"].includes(j.type))
		.map(([name]) => name);
}

// moveit::core::RobotState::setToDefaultValues: 0, or the middle of the limits when 0 is outside them
export function defaultPositions(robot) {
	const positions = {};
	for (const name of movableJoints(robot)) {
		const limit = robot.joints[name].limit;
		const lower = limit?.lower, upper = limit?.upper;
		const bounded = robot.joints[name].type !== "continuous" && Number.isFinite(lower) && Number.isFinite(upper);
		positions[name] = bounded && (lower > 0 || upper < 0) ? (lower + upper) / 2 : 0;
	}
	return positions;
}

// moveit_msgs/RobotState onto joint positions (robotStateMsgToRobotState): a full state starts
// from the defaults, a diff (is_diff) from the positions given. Unknown joints are ignored.
export function applyRobotState(robot, positions, state) {
	const out = state?.is_diff ? { ...positions } : defaultPositions(robot);
	const names = state?.joint_state?.name ?? [];
	const values = state?.joint_state?.position ?? [];
	names.forEach((name, i) => {
		if (name in robot.joints && Number.isFinite(values[i]))
			out[name] = values[i];
	});
	return out;
}

// is a moveit_msgs/RobotState empty (moveit::core::isEmpty)
export function isEmptyState(state) {
	return !state || ((state.joint_state?.name ?? []).length === 0 && (state.multi_dof_joint_state?.joint_names ?? []).length === 0
		&& (state.attached_collision_objects ?? []).length === 0);
}

// DisplayRobotState.highlight_links (moveit_msgs/ObjectColor[]) -> Map link -> [r, g, b]
export function highlightMap(highlightLinks) {
	return new Map((highlightLinks ?? []).map((h) => [h.id, [h.color?.r ?? 0, h.color?.g ?? 0, h.color?.b ?? 0]]));
}
