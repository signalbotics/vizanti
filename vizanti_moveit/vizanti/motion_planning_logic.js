// MoveIt's MotionPlanning display without the page: the SRDF (planning groups, end effectors,
// named states), which joints a group moves, where its end-effector handle goes, and the
// requests sent to move_group (IK, planning). Pure (no imports), so it runs under node --test.

// a tiny XML reader for SRDF: elements with attributes and children
function parseXml(text) {
	const root = { tag: "#root", attrs: {}, children: [] };
	const stack = [root];
	const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
	let m;
	while ((m = re.exec(text))) {
		if (!m[2])
			continue; // comment or declaration
		const [, closing, tag, attrText, selfClosing] = m;
		if (closing) {
			if (stack.length > 1)
				stack.pop();
			continue;
		}
		const attrs = {};
		for (const a of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
			attrs[a[1]] = a[2] ?? a[3];
		const element = { tag, attrs, children: [] };
		stack[stack.length - 1].children.push(element);
		if (!selfClosing)
			stack.push(element);
	}
	const robot = root.children.find((c) => c.tag === "robot");
	if (!robot)
		throw new Error("This is not an SRDF: there is no <robot> element.");
	return robot;
}

// SRDF -> { groups: { [name]: { chains: [[base, tip]], joints, links, subgroups } },
//           endEffectors: [{ name, link, group, parentGroup }], states: { [group]: { [state]: { joint: value } } } }
export function parseSrdf(text) {
	const robot = parseXml(text);
	const srdf = { name: robot.attrs.name ?? "", groups: {}, endEffectors: [], states: {} };
	for (const g of robot.children.filter((c) => c.tag === "group")) {
		const group = { chains: [], joints: [], links: [], subgroups: [] };
		for (const c of g.children) {
			if (c.tag === "chain" && c.attrs.base_link && c.attrs.tip_link)
				group.chains.push([c.attrs.base_link, c.attrs.tip_link]);
			else if (c.tag === "joint" && c.attrs.name)
				group.joints.push(c.attrs.name);
			else if (c.tag === "link" && c.attrs.name)
				group.links.push(c.attrs.name);
			else if (c.tag === "group" && c.attrs.name)
				group.subgroups.push(c.attrs.name);
		}
		if (g.attrs.name)
			srdf.groups[g.attrs.name] = group;
	}
	for (const e of robot.children.filter((c) => c.tag === "end_effector"))
		srdf.endEffectors.push({ name: e.attrs.name, link: e.attrs.parent_link, group: e.attrs.group, parentGroup: e.attrs.parent_group ?? null });
	for (const s of robot.children.filter((c) => c.tag === "group_state")) {
		const values = {};
		for (const j of s.children.filter((c) => c.tag === "joint" && c.attrs.name))
			values[j.attrs.name] = Number(j.attrs.value?.split(/\s+/)[0]);
		(srdf.states[s.attrs.group] ??= {})[s.attrs.name] = values;
	}
	return srdf;
}

// the joints of the chain from base to tip (URDF joints, in order)
function chainJoints(robot, base, tip) {
	const parentJoint = {};
	for (const [name, j] of Object.entries(robot.joints))
		parentJoint[j.child] = name;
	const path = [];
	for (let link = tip; link && link !== base; link = robot.joints[parentJoint[link]]?.parent) {
		if (!parentJoint[link])
			return []; // base is not above tip
		path.unshift(parentJoint[link]);
	}
	return path;
}

const ACTIVE = ["revolute", "continuous", "prismatic"];

// The joints a group moves (active ones, not mimic), in URDF order.
export function groupJoints(robot, srdf, groupName, seen = new Set()) {
	const group = srdf.groups[groupName];
	if (!group || seen.has(groupName))
		return [];
	seen.add(groupName);
	const names = new Set(group.joints);
	for (const [base, tip] of group.chains)
		for (const j of chainJoints(robot, base, tip))
			names.add(j);
	for (const link of group.links)
		for (const [name, j] of Object.entries(robot.joints))
			if (j.child === link)
				names.add(name);
	for (const sub of group.subgroups)
		for (const j of groupJoints(robot, srdf, sub, seen))
			names.add(j);
	return Object.keys(robot.joints).filter((name) => names.has(name) && ACTIVE.includes(robot.joints[name].type) && !robot.joints[name].mimic);
}

// Where a group's end-effector handle goes: the parent link of an end effector of this group
// (RViz's robot_interaction), else the tip of its chain; null when the group has neither.
export function endEffectorLink(robot, srdf, groupName) {
	const ee = srdf.endEffectors.find((e) => e.parentGroup === groupName)
		?? srdf.endEffectors.find((e) => e.link && groupJoints(robot, srdf, groupName).some((j) => robot.joints[j].child === e.link));
	if (ee?.link)
		return ee.link;
	const chain = srdf.groups[groupName]?.chains.at(-1);
	return chain ? chain[1] : null;
}

// the planning groups the panel offers (those that move something), in SRDF order
export function planningGroups(robot, srdf) {
	return Object.keys(srdf.groups).filter((g) => groupJoints(robot, srdf, g).length > 0);
}

// a moveit_msgs/RobotState with the given joint positions
export function robotStateMsg(positions, joints) {
	return { joint_state: { name: joints, position: joints.map((j) => positions[j] ?? 0) }, is_diff: false };
}

// moveit_msgs/srv/GetPositionIK request: the group's joints to put `link` at `pose` (in `frame`)
export function ikRequest({ group, positions, joints, link, frame, pose, avoidCollisions = true, timeout = 0.1 }) {
	return {
		ik_request: {
			group_name: group,
			robot_state: robotStateMsg(positions, joints),
			avoid_collisions: avoidCollisions,
			ik_link_name: link,
			pose_stamped: { header: { frame_id: frame, stamp: { sec: 0, nanosec: 0 } }, pose },
			timeout: { sec: Math.floor(timeout), nanosec: Math.round((timeout % 1) * 1e9) },
		},
	};
}

// GetPositionIK response -> joint positions (merged over `positions`), or null when it failed
export function ikSolution(response, positions) {
	if (response?.error_code?.val !== 1)
		return null;
	const out = { ...positions };
	const js = response.solution?.joint_state ?? {};
	(js.name ?? []).forEach((name, i) => {
		if (Number.isFinite(js.position?.[i]))
			out[name] = js.position[i];
	});
	return out;
}

// moveit_msgs/action/MoveGroup goal: plan (and maybe execute) the group to the goal state's joints
export function moveGroupGoal({ group, goal, joints, start = null, planOnly = true, planner = "", attempts = 10, time = 5, velocity = 0.1, acceleration = 0.1 }) {
	return {
		request: {
			group_name: group,
			start_state: start ? robotStateMsg(start, Object.keys(start)) : { is_diff: true },
			goal_constraints: [{
				name: "",
				joint_constraints: joints.map((j) => ({ joint_name: j, position: goal[j] ?? 0, tolerance_above: 1e-4, tolerance_below: 1e-4, weight: 1 })),
			}],
			planner_id: planner,
			num_planning_attempts: attempts,
			allowed_planning_time: time,
			max_velocity_scaling_factor: velocity,
			max_acceleration_scaling_factor: acceleration,
		},
		planning_options: { plan_only: planOnly, replan: false, replan_attempts: 0, replan_delay: 0, planning_scene_diff: { is_diff: true, robot_state: { is_diff: true } } },
	};
}

// moveit_msgs/MoveItErrorCodes names for the status line
const ERRORS = {
	1: "SUCCESS", 99999: "FAILURE", [-1]: "PLANNING_FAILED", [-2]: "INVALID_MOTION_PLAN",
	[-3]: "MOTION_PLAN_INVALIDATED_BY_ENVIRONMENT_CHANGE", [-4]: "CONTROL_FAILED", [-5]: "UNABLE_TO_AQUIRE_SENSOR_DATA",
	[-6]: "TIMED_OUT", [-7]: "PREEMPTED", [-10]: "START_STATE_IN_COLLISION", [-11]: "START_STATE_VIOLATES_PATH_CONSTRAINTS",
	[-12]: "GOAL_IN_COLLISION", [-13]: "GOAL_VIOLATES_PATH_CONSTRAINTS", [-14]: "GOAL_CONSTRAINTS_VIOLATED",
	[-15]: "INVALID_GROUP_NAME", [-16]: "INVALID_GOAL_CONSTRAINTS", [-17]: "INVALID_ROBOT_STATE",
	[-18]: "INVALID_LINK_NAME", [-19]: "INVALID_OBJECT_NAME", [-21]: "FRAME_TRANSFORM_FAILURE",
	[-22]: "COLLISION_CHECKING_UNAVAILABLE", [-23]: "ROBOT_STATE_STALE", [-24]: "SENSOR_INFO_STALE",
	[-25]: "COMMUNICATION_FAILURE", [-26]: "CRASH", [-27]: "ABORT", [-31]: "NO_IK_SOLUTION",
};
export function errorName(code) {
	return ERRORS[code] ?? `error ${code}`;
}
