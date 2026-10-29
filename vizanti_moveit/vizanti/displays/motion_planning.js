// The MotionPlanning display (moveit_rviz_plugin/MotionPlanning) for Vizanti: everything the
// PlanningScene display shows, plus the query start and goal states, a 6-DOF handle on the
// goal's end effector that is solved with inverse kinematics while it is dragged (as RViz's
// robot interaction does), and MoveIt's Planning tab: group, start and goal states, Plan,
// Execute, Plan & Execute and Stop, with the planned path animated.
import { FEEDBACK, INTERACTION } from '@vizanti/geometry/interaction.js';
import { forwardKinematics } from '@vizanti/geometry/kinematics.js';
import { MarkerHandles } from '@vizanti/core/marker_handles.js';
import { PlanningSceneDisplay } from './planning_scene.js';
import { defaultPositions } from '../moveit_state_logic.js';
import { waypoints, Animator, stateDisplayTime } from '../trajectory_logic.js';
import { parseSrdf, groupJoints, endEffectorLink, planningGroups, ikRequest, ikSolution, moveGroupGoal, errorName } from '../motion_planning_logic.js';

const CURRENT = "<current>";
const HANDLE = "goal_end_effector";
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const el = (tag, className = "", text = "") => {
	const element = document.createElement(tag);
	if (className)
		element.className = className;
	if (text)
		element.textContent = text;
	return element;
};

// a 6-DOF interactive marker for an end effector (a move arrow pair and a ring per axis, and a
// sphere to drag freely), at `pose` in `frame`
function endEffectorMarker(frame, pose, scale) {
	const axis = (name, mode, q) => ({ name, interaction_mode: mode, orientation: q, orientation_mode: 0, always_visible: false, markers: [], independent_marker_orientation: false, description: "" });
	const s = Math.SQRT1_2;
	const X = { x: 0, y: 0, z: 0, w: 1 }, Y = { x: 0, y: 0, z: s, w: s }, Z = { x: 0, y: -s, z: 0, w: s };
	const sphere = {
		type: 2, action: 0, pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
		scale: { x: scale * 0.45, y: scale * 0.45, z: scale * 0.45 }, color: { r: 0.2, g: 0.6, b: 1, a: 0.5 }, points: [], colors: [],
	};
	return {
		header: { frame_id: frame }, name: HANDLE, description: "", scale, pose, menu_entries: [],
		controls: [
			{ ...axis("move_3d", INTERACTION.MOVE_ROTATE_3D, X), always_visible: true, markers: [sphere] },
			axis("move_x", INTERACTION.MOVE_AXIS, X), axis("rotate_x", INTERACTION.ROTATE_AXIS, X),
			axis("move_y", INTERACTION.MOVE_AXIS, Y), axis("rotate_y", INTERACTION.ROTATE_AXIS, Y),
			axis("move_z", INTERACTION.MOVE_AXIS, Z), axis("rotate_z", INTERACTION.ROTATE_AXIS, Z),
		],
	};
}

export class MotionPlanningDisplay extends PlanningSceneDisplay {

	static msgTypes = ["moveit_msgs/msg/PlanningScene"];

	static properties = {
		...PlanningSceneDisplay.properties,
		semantic: { type: "string", label: "Robot Description Semantic", default: "/robot_description_semantic", help: "The topic with the robot's SRDF (std_msgs/String)." },
		group: { type: "string", label: "Planning Group", default: "", help: "The planning group (chosen in the Motion Planning section below)." },
		show_start: { type: "bool", label: "Query Start State", default: false, help: "Set a custom start state for the motion planning query" },
		show_goal: { type: "bool", label: "Query Goal State", default: true, help: "Shows the goal state for the motion planning query" },
		marker_size: { type: "float", label: "Interactive Marker Size", default: 0, min: 0, max: 5, step: 0.05, help: "Specifies scale of the interactive marker overlaid on the robot. 0 is auto scale." },
		start_color: { type: "color", label: "Start State Color", default: "#00ff00", help: "The highlight color for the start state" },
		start_alpha: { type: "float", label: "Start State Alpha", default: 1, min: 0, max: 1, step: 0.05, slider: true },
		goal_color: { type: "color", label: "Goal State Color", default: "#fa8000", help: "The highlight color for the goal state" },
		goal_alpha: { type: "float", label: "Goal State Alpha", default: 1, min: 0, max: 1, step: 0.05, slider: true },
		show_path: { type: "bool", label: "Show Planned Path", default: true },
		path_alpha: { type: "float", label: "Planned Path Alpha", default: 0.5, min: 0, max: 1, step: 0.05, slider: true },
		loop_path: { type: "bool", label: "Loop Animation", default: false },
	};

	static fromRviz(entry) {
		const props = PlanningSceneDisplay.fromRviz(entry);
		const request = entry?.["Planning Request"] ?? {};
		if (typeof request["Planning Group"] === "string")
			props.group = request["Planning Group"];
		for (const [key, name] of [["show_start", "Query Start State"], ["show_goal", "Query Goal State"]])
			if (typeof request[name] === "boolean")
				props[key] = request[name];
		if (Number.isFinite(Number(request["Interactive Marker Size"])))
			props.marker_size = Number(request["Interactive Marker Size"]);
		const path = entry?.["Planned Path"] ?? {};
		if (typeof path["Loop Animation"] === "boolean")
			props.loop_path = path["Loop Animation"];
		if (Number.isFinite(Number(path["Robot Alpha"])))
			props.path_alpha = Number(path["Robot Alpha"]);
		return props;
	}

	onCreate() {
		super.onCreate();
		this.srdf = null;
		this.current = {}; // joint positions from /joint_states
		this.start = null; // null: the current state
		this.goal = null;
		this.startChoice = CURRENT;
		this.goalChoice = CURRENT;
		this.settings = { velocity: 0.1, acceleration: 0.1, time: 5, attempts: 10 };
		this.message = "";
		this.busy = null; // the running action: { kind, handle }
		this.lastPlan = null; // moveit_msgs/RobotTrajectory of the last plan
		this.ik = { pending: null, running: false, release: false };
		this.handles = new MarkerHandles(this, { onFeedback: (entry, control, event) => this.onHandle(event) });

		const sceneRobot = this.model.onRobot;
		this.model.onRobot = (robot) => {
			sceneRobot(robot);
			for (const key of ["startMesh", "goalMesh", "pathMesh"]) {
				this.model.drop(this[key]);
				this[key] = this.model.mesh();
				this[key].group.visible = false;
			}
			this.current = { ...defaultPositions(robot), ...this.current };
			this.setupGroup();
		};
		this.unsubSemantic = null;
		this.listenSemantic();
		this.unsubJoints = this.ctx.subscribe("/joint_states", "sensor_msgs/msg/JointState", 100, (msg) => {
			msg.name?.forEach((name, i) => {
				if (Number.isFinite(msg.position?.[i]))
					this.current[name] = msg.position[i];
			});
			if (this.goal === null)
				this.setupGroup();
			else if (this.startChoice === CURRENT)
				this.redrawQuery();
		});
	}

	listenSemantic() {
		this.unsubSemantic?.();
		this.unsubSemantic = this.ctx.subscribe(this.props.semantic, "std_msgs/msg/String", 0, (msg) => {
			if (msg.data === this.srdfText)
				return;
			try {
				this.srdf = parseSrdf(msg.data);
				this.srdfText = msg.data;
			} catch (e) {
				this.status.error("The robot's SRDF could not be read: " + e.message);
				return;
			}
			this.setupGroup();
		});
	}

	// the group is known once both descriptions are in: its joints, its end effector, the goal handle
	setupGroup() {
		const robot = this.model.robot;
		if (!robot || !this.srdf || !this.startMesh)
			return;
		const groups = planningGroups(robot, this.srdf);
		if (!groups.includes(this.props.group))
			this.props.group = groups[0] ?? ""; // the first group, as RViz picks it
		this.joints = groupJoints(robot, this.srdf, this.props.group);
		this.eeLink = endEffectorLink(robot, this.srdf, this.props.group);
		this.grabEndEffector();
		if (this.goal === null)
			this.goal = { ...this.current };
		this.applyQueryLook();
		this.placeHandle();
		this.redrawQuery();
		this.refreshPanel();
	}

	startPositions() {
		return this.start ?? this.current;
	}

	// the start and goal ghosts
	redrawQuery() {
		if (!this.startMesh || !this.goal)
			return;
		const startPlaced = this.model.pose(this.startMesh, this.startPositions());
		this.startMesh.group.visible = startPlaced && this.props.show_start;
		const goalPlaced = this.model.pose(this.goalMesh, this.goal);
		this.goalMesh.group.visible = goalPlaced && this.props.show_goal;
		this.handles.setVisible(this.enabled && this.props.show_goal && !!this.eeLink);
		this.requestRender();
	}

	applyQueryLook() {
		for (const [mesh, color, alpha] of [[this.startMesh, this.props.start_color, this.props.start_alpha], [this.goalMesh, this.props.goal_color, this.props.goal_alpha], [this.pathMesh, null, this.props.path_alpha]]) {
			if (!mesh)
				continue;
			mesh.setVisibility(true, false);
			mesh.color = color ? hexToRgb(color) : null;
			mesh.setOpacity(alpha);
		}
	}

	// ---- the end-effector handle ----

	handleScale() {
		return this.props.marker_size > 0 ? this.props.marker_size : 0.25;
	}

	// the handle at the goal state's end effector (in the robot's root frame)
	placeHandle() {
		if (!this.eeLink || !this.goal) {
			this.handles.clear();
			return;
		}
		const link = forwardKinematics(this.model.robot, this.goal).get(this.eeLink);
		if (!link)
			return;
		const pose = { position: { x: link.translation[0], y: link.translation[1], z: link.translation[2] }, orientation: link.rotation };
		const entry = this.handles.markers.get(HANDLE);
		if (entry && entry.scale === this.handleScale())
			this.handles.placePose(entry, pose);
		else
			this.handles.setMarker(endEffectorMarker(this.model.robot.root, pose, this.handleScale())).scale = this.handleScale();
		this.handles.setVisible(this.enabled && this.props.show_goal);
		this.requestRender();
	}

	// The goal state's end-effector links (the EE link and everything below it) drag the handle
	// freely, as in RViz, where the end effector itself is part of the interactive marker.
	grabEndEffector() {
		if (!this.goalMesh)
			return;
		const below = new Set(this.eeLink ? [this.eeLink] : []);
		let grew = true;
		while (grew) {
			grew = false;
			for (const j of Object.values(this.model.robot.joints)) {
				if (below.has(j.parent) && !below.has(j.child)) {
					below.add(j.child);
					grew = true;
				}
			}
		}
		const grab = { display: this, marker: HANDLE, control: 0 }; // control 0: the free move/rotate sphere
		for (const [name, entry] of this.goalMesh.links)
			entry.group.userData.interactive = below.has(name) ? grab : undefined;
	}

	onPointer(kind, args) {
		return this.handles.onPointer(kind, args);
	}

	// a drag of the handle: solve IK for each new pose (one request at a time, the latest wins)
	onHandle(event) {
		if (event === FEEDBACK.POSE_UPDATE) {
			this.ik.pending = this.handles.poseOf(this.handles.markers.get(HANDLE));
			this.solveIk();
		} else if (event === FEEDBACK.MOUSE_UP) {
			this.ik.release = true;
			if (!this.ik.running) {
				this.ik.release = false;
				this.placeHandle(); // back onto the solved end effector
			}
		}
	}

	async solveIk() {
		if (this.ik.running || !this.ik.pending)
			return;
		this.ik.running = true;
		const pose = this.ik.pending;
		this.ik.pending = null;
		try {
			const response = await this.ctx.callService("/compute_ik", "moveit_msgs/srv/GetPositionIK", ikRequest({
				group: this.props.group, positions: this.goal, joints: this.joints, link: this.eeLink, frame: this.model.robot.root, pose,
			}), 3000);
			const solved = ikSolution(response, this.goal);
			if (solved) {
				this.goal = solved;
				this.goalChoice = "";
				this.setMessage("");
				this.redrawQuery();
				this.refreshJoints();
			} else {
				this.setMessage(`No IK solution (${errorName(response?.error_code?.val)})`, true);
			}
		} catch (e) {
			this.setMessage(`compute_ik: ${e.message}`, true);
		}
		this.ik.running = false;
		if (this.ik.pending)
			this.solveIk();
		else if (this.ik.release && !this.handles.drag) {
			this.ik.release = false;
			this.placeHandle();
		}
	}

	// ---- planning ----

	run(kind) {
		if (this.busy || !this.props.group)
			return;
		let handle;
		if (kind === "execute") {
			if (!this.lastPlan)
				return;
			handle = this.ctx.action("/execute_trajectory", "moveit_msgs/action/ExecuteTrajectory").send({ trajectory: this.lastPlan });
		} else {
			handle = this.ctx.action("/move_action", "moveit_msgs/action/MoveGroup").send(moveGroupGoal({
				group: this.props.group, goal: this.goal, joints: this.joints,
				start: this.start, planOnly: kind === "plan",
				velocity: this.settings.velocity, acceleration: this.settings.acceleration,
				time: this.settings.time, attempts: this.settings.attempts,
			}));
		}
		this.busy = { kind, handle };
		this.setMessage({ plan: "Planning…", execute: "Executing…", both: "Planning and executing…" }[kind]);
		this.refreshPanel();
		handle.result.then(({ status, values, ok }) => {
			this.busy = null;
			const code = values?.error_code?.val;
			if (!ok)
				this.setMessage(String(values), true);
			else if (status === "canceled")
				this.setMessage("Stopped", true);
			else if (code !== 1)
				this.setMessage(errorName(code), true);
			else {
				this.setMessage({ plan: "Planning succeeded", execute: "Executed", both: "Planned and executed" }[kind]);
				if (kind !== "execute") {
					this.lastPlan = values.planned_trajectory;
					this.animate({ trajectory_start: values.trajectory_start, trajectory: [values.planned_trajectory] });
				}
			}
			this.refreshPanel();
		});
	}

	stop() {
		this.busy?.handle.cancel();
	}

	animate(displayTrajectory) {
		clearInterval(this.pathTimer);
		const points = waypoints(this.model.robot, this.startPositions(), displayTrajectory);
		if (!points.length || !this.props.show_path)
			return;
		const animator = new Animator(points, { displayTime: stateDisplayTime("3x"), loop: this.props.loop_path });
		let last = performance.now();
		const show = (i) => {
			this.model.pose(this.pathMesh, points[i].positions);
			this.pathMesh.group.visible = this.props.show_path && (!animator.done || this.props.loop_path);
			this.requestRender();
		};
		show(0);
		this.pathTimer = setInterval(() => {
			const now = performance.now();
			const { index, done, changed } = animator.step((now - last) / 1000);
			last = now;
			if (changed)
				show(index);
			if (done && !this.props.loop_path) {
				clearInterval(this.pathTimer);
				show(index);
			}
		}, 33);
	}

	// ---- the Motion Planning section (in the display's settings) ----

	setMessage(text, error = false) {
		this.message = text;
		this.messageError = error;
		if (this.panel?.message) {
			this.panel.message.textContent = text;
			this.panel.message.classList.toggle("mp_error", error);
		}
		if (error)
			this.status.warn(text);
		else
			this.status.ok();
	}

	namedStates() {
		return Object.keys(this.srdf?.states?.[this.props.group] ?? {});
	}

	// "<current>" or a named state of the group: its positions over the current ones
	statePositions(choice) {
		if (choice === CURRENT)
			return { ...this.current };
		return { ...this.current, ...(this.srdf?.states?.[this.props.group]?.[choice] ?? {}) };
	}

	buildCustomEditor(container) {
		const details = el("details", "mp_panel");
		details.open = true;
		details.append(el("summary", "", "Motion Planning"));
		const body = el("div", "mp_body");
		details.appendChild(body);
		container.appendChild(details);
		this.panel = { body };
		this.renderPanel();
	}

	refreshPanel() {
		if (this.panel?.body?.isConnected)
			this.renderPanel();
	}

	renderPanel() {
		const body = this.panel.body;
		body.replaceChildren();
		const row = (label, input) => {
			const r = el("label", "mp_row");
			r.append(el("span", "", label), input);
			body.appendChild(r);
			return input;
		};
		const select = (options, value, onChange) => {
			const s = el("select");
			for (const o of options)
				s.appendChild(new Option(o, o));
			s.value = value;
			s.addEventListener("change", () => onChange(s.value));
			return s;
		};
		const number = (value, min, max, step, onChange) => {
			const i = el("input");
			Object.assign(i, { type: "number", min, max, step, value });
			i.addEventListener("change", () => {
				const n = Number(i.value);
				if (Number.isFinite(n))
					onChange(Math.min(max, Math.max(min, n)));
			});
			return i;
		};

		if (!this.srdf || !this.model.robot) {
			body.appendChild(el("p", "mp_note", "Waiting for the robot description and its SRDF…"));
			return;
		}
		row("Planning Group", select(planningGroups(this.model.robot, this.srdf), this.props.group, (g) => {
			this.setProp("group", g);
			this.goal = null;
			this.goalChoice = this.startChoice = CURRENT;
			this.start = null;
			this.setupGroup();
		}));
		const states = [CURRENT, ...this.namedStates()];
		row("Start State", select(states, this.startChoice, (v) => {
			this.startChoice = v;
			this.start = v === CURRENT ? null : this.statePositions(v);
			this.redrawQuery();
		}));
		row("Goal State", select(states.includes(this.goalChoice) ? states : ["", ...states], this.goalChoice, (v) => {
			if (!v)
				return;
			this.goalChoice = v;
			this.goal = this.statePositions(v);
			this.placeHandle();
			this.redrawQuery();
			this.refreshJoints();
		}));
		row("Velocity Scaling", number(this.settings.velocity, 0.01, 1, 0.05, (v) => { this.settings.velocity = v; }));
		row("Accel. Scaling", number(this.settings.acceleration, 0.01, 1, 0.05, (v) => { this.settings.acceleration = v; }));
		row("Planning Time (s)", number(this.settings.time, 0.1, 300, 0.5, (v) => { this.settings.time = v; }));
		row("Planning Attempts", number(this.settings.attempts, 1, 1000, 1, (v) => { this.settings.attempts = Math.round(v); }));

		const buttons = el("div", "mp_buttons");
		const button = (text, onClick, enabled) => {
			const b = el("button", "", text);
			b.type = "button";
			b.disabled = !enabled;
			b.addEventListener("click", onClick);
			buttons.appendChild(b);
		};
		const idle = !this.busy;
		button("Plan", () => this.run("plan"), idle);
		button("Execute", () => this.run("execute"), idle && !!this.lastPlan);
		button("Plan & Execute", () => this.run("both"), idle);
		button("Stop", () => this.stop(), !idle);
		body.appendChild(buttons);
		this.panel.message = el("p", "mp_message" + (this.messageError ? " mp_error" : ""), this.message);
		body.appendChild(this.panel.message);

		const joints = el("details", "mp_joints");
		joints.append(el("summary", "", "Joints (goal state)"));
		this.panel.joints = el("div");
		joints.appendChild(this.panel.joints);
		body.appendChild(joints);
		this.refreshJoints();
	}

	// a slider per joint of the group, for the goal state
	refreshJoints() {
		const box = this.panel?.joints;
		if (!box?.isConnected || !this.goal)
			return;
		box.replaceChildren();
		for (const name of this.joints ?? []) {
			const limit = this.model.robot.joints[name].limit;
			const lower = Number.isFinite(limit?.lower) ? limit.lower : -Math.PI, upper = Number.isFinite(limit?.upper) ? limit.upper : Math.PI;
			const r = el("label", "mp_row");
			const value = el("span", "mp_value", (this.goal[name] ?? 0).toFixed(3));
			const slider = el("input");
			Object.assign(slider, { type: "range", min: lower, max: upper, step: (upper - lower) / 1000, value: this.goal[name] ?? 0 });
			slider.addEventListener("input", () => {
				this.goal = { ...this.goal, [name]: Number(slider.value) };
				this.goalChoice = "";
				value.textContent = Number(slider.value).toFixed(3);
				this.placeHandle();
				this.redrawQuery();
			});
			r.append(el("span", "", name), slider, value);
			box.appendChild(r);
		}
	}

	// ---- display hooks ----

	onTfChange() {
		super.onTfChange();
		this.redrawQuery();
		this.handles.attachMissing();
	}

	onFixedFrameChange() {
		super.onFixedFrameChange();
		this.handles.attachAll();
	}

	onPropertyChange(key) {
		if (key === "semantic") {
			this.listenSemantic();
			return;
		}
		if (["start_color", "start_alpha", "goal_color", "goal_alpha", "path_alpha"].includes(key))
			this.applyQueryLook();
		if (key === "marker_size")
			this.placeHandle();
		if (key === "group")
			this.setupGroup();
		super.onPropertyChange(key);
		this.redrawQuery();
	}

	_setEnabled(enabled) {
		super._setEnabled(enabled);
		this.handles.setVisible(enabled && this.props.show_goal);
	}

	onDestroy() {
		clearInterval(this.pathTimer);
		this.busy?.handle.cancel();
		this.unsubSemantic?.();
		this.unsubJoints?.();
		this.handles.clear();
		super.onDestroy();
	}
}

// the Motion Planning section's look, once
if (!document.querySelector("style[data-vizanti-moveit]")) {
	const style = document.createElement("style");
	style.dataset.vizantiMoveit = "";
	style.textContent = `
.mp_panel > summary { font-weight: bold; cursor: pointer; margin: 6px 0; }
.mp_body { display: flex; flex-direction: column; gap: 4px; }
.mp_row { display: grid; grid-template-columns: 9.5em 1fr auto; gap: 6px; align-items: center; }
.mp_row > select, .mp_row > input { min-width: 0; width: 100%; box-sizing: border-box; }
.mp_buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 4px; }
.mp_message { margin: 2px 0; min-height: 1.2em; color: #3ecf6e; }
.mp_message.mp_error { color: #ff6b6b; }
.mp_value { font-family: monospace; min-width: 4.5em; text-align: right; }
.mp_joints > summary { cursor: pointer; margin-top: 4px; }
.mp_note { margin: 0; opacity: 0.8; }
`;
	document.head.appendChild(style);
}
