// The Trajectory display (moveit_rviz_plugin/Trajectory) for Vizanti: animates the planned paths
// MoveIt publishes (moveit_msgs/DisplayTrajectory), optionally looping and with a trail of the
// states it passes through, as in RViz (see ../trajectory_logic.js).
import { Display } from '@vizanti/plugin_api.js';
import { MoveItRobot } from '../moveit_robot.js';
import { defaultPositions } from '../moveit_state_logic.js';
import { stateDisplayTime, waypoints, Animator, trailIndices } from '../trajectory_logic.js';

const DISPLAY_TIMES = ["3x", "1x", "0.5x", "0.05s", "0.1s", "0.5s"];
const TRAIL_MAX = 60; // trail copies at most: each one is a whole robot model
const TICK_MS = 33;

const rvizColor = (value) => {
	const parts = String(value ?? "").split(";").map((s) => Number(s.trim()));
	return parts.length === 3 && parts.every(Number.isFinite) ? "#" + parts.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("") : null;
};
const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export class TrajectoryDisplay extends Display {

	static msgTypes = ["moveit_msgs/msg/DisplayTrajectory"];

	static properties = {
		description: { type: "string", label: "Robot Description", default: "/robot_description", help: "The topic with the robot's URDF (std_msgs/String)." },
		topic: { type: "topic", label: "Trajectory Topic", default: "/display_planned_path" },
		visual: { type: "bool", label: "Show Robot Visual", default: true },
		collision: { type: "bool", label: "Show Robot Collision", default: false },
		alpha: { type: "float", label: "Robot Alpha", default: 0.5, min: 0, max: 1, step: 0.05, slider: true },
		display_time: { type: "enum", label: "State Display Time", default: "3x", options: DISPLAY_TIMES.map((value) => ({ value, label: value })), help: "Replay speed of trajectory. Either as factor of its time parameterization or as constant time (s) per waypoint." },
		loop: { type: "bool", label: "Loop Animation", default: false, help: "Indicates whether the last received path is to be animated in a loop" },
		trail: { type: "bool", label: "Show Trail", default: false, help: "Show a path trail" },
		trail_step: { type: "int", label: "Trail Step Size", default: 1, min: 1, max: 1000, help: "Specifies the step size of the samples shown in the trajectory trail." },
		interrupt: { type: "bool", label: "Interrupt Display", default: false, help: "Immediately show newly planned trajectory, interrupting the currently displayed one." },
		color_enabled: { type: "bool", label: "Color Enabled", default: false, help: "Specifies whether robot coloring is enabled" },
		color: { type: "color", label: "Robot Color", default: "#963296", help: "The color of the animated robot" },
	};

	static fromRviz(entry) {
		const props = {};
		const topic = entry?.["Trajectory Topic"]?.Value ?? entry?.["Trajectory Topic"];
		if (typeof topic === "string" && topic)
			props.topic = topic.startsWith("/") ? topic : `/${topic}`;
		for (const [key, rviz] of [["visual", "Show Robot Visual"], ["collision", "Show Robot Collision"], ["loop", "Loop Animation"], ["trail", "Show Trail"], ["interrupt", "Interrupt Display"], ["color_enabled", "Color Enabled"]])
			if (typeof entry?.[rviz] === "boolean")
				props[key] = entry[rviz];
		if (Number.isFinite(Number(entry?.["Robot Alpha"])))
			props.alpha = Number(entry["Robot Alpha"]);
		if (Number.isInteger(Number(entry?.["Trail Step Size"])))
			props.trail_step = Math.max(1, Number(entry["Trail Step Size"]));
		if (DISPLAY_TIMES.includes(entry?.["State Display Time"]))
			props.display_time = entry["State Display Time"];
		const color = rvizColor(entry?.["Robot Color"]);
		if (color)
			props.color = color;
		return props;
	}

	onCreate() {
		this.points = [];
		this.queued = null; // a trajectory waiting for the current one to finish
		this.animator = null;
		this.robotMesh = null;
		this.trailMeshes = [];
		this.timer = null;
		this.model = new MoveItRobot(this, () => {
			this.clearMeshes();
			this.robotMesh = this.model.mesh();
			this.robotMesh.group.visible = false;
			this.applyLook();
			this.status.warn("No trajectory received");
		});
		this.model.listen(this.props.description);
	}

	onMessage(msg) {
		if (!this.model.robot)
			return;
		const points = waypoints(this.model.robot, defaultPositions(this.model.robot), msg);
		if (points.length === 0)
			return;
		if (this.animating() && !this.props.interrupt)
			this.queued = points; // shown when the current animation ends, as RViz does
		else
			this.start(points);
	}

	animating() {
		return !!this.animator && !this.animator.done;
	}

	start(points) {
		this.points = points;
		this.queued = null;
		this.animator = new Animator(points, { displayTime: stateDisplayTime(this.props.display_time), loop: this.props.loop });
		this.buildTrail();
		this.show(0);
		this.setInfo({ "Waypoints": points.length, "Duration (s)": points.reduce((sum, p) => sum + p.dt, 0).toFixed(2) });
		this.status.ok();
		this.run();
	}

	run() {
		clearInterval(this.timer);
		let last = performance.now();
		this.timer = setInterval(() => {
			const now = performance.now();
			const { index, done, changed } = this.animator.step((now - last) / 1000);
			last = now;
			if (changed)
				this.show(index);
			if (done && this.queued) {
				this.start(this.queued);
				return;
			}
			if (done && !this.props.loop) {
				clearInterval(this.timer);
				this.timer = null;
				this.show(index);
			}
		}, TICK_MS);
	}

	// the animated robot at a waypoint; the trail copies passed so far
	show(index) {
		if (!this.robotMesh || !this.points.length)
			return;
		const placed = this.model.pose(this.robotMesh, this.points[index].positions);
		// the animated robot stays while it moves, loops, or a trail is shown
		this.robotMesh.group.visible = placed && (this.animating() || this.props.loop || this.props.trail);
		for (const { mesh, at } of this.trailMeshes)
			mesh.group.visible = at <= index && this.model.placeRoot(mesh);
		this.requestRender();
	}

	buildTrail() {
		for (const { mesh } of this.trailMeshes)
			this.model.drop(mesh);
		this.trailMeshes = [];
		if (!this.props.trail || !this.points.length)
			return;
		let indices = trailIndices(this.points.length, this.props.trail_step);
		if (indices.length > TRAIL_MAX) {
			const stride = Math.ceil(indices.length / TRAIL_MAX);
			indices = indices.filter((_, i) => i % stride === 0 || i === indices.length - 1);
			this.status.warn(`Trail thinned to ${indices.length} states (raise Trail Step Size to choose them).`);
		}
		for (const at of indices) {
			const mesh = this.model.mesh();
			this.model.pose(mesh, this.points[at].positions);
			mesh.group.visible = false;
			this.trailMeshes.push({ mesh, at });
		}
		this.applyLook();
	}

	applyLook() {
		const color = this.props.color_enabled ? hexToRgb(this.props.color) : null;
		for (const mesh of [this.robotMesh, ...this.trailMeshes.map((t) => t.mesh)]) {
			if (!mesh)
				continue;
			mesh.setVisibility(this.props.visual, this.props.collision);
			mesh.color = color;
			mesh.setOpacity(this.props.alpha);
		}
		this.requestRender();
	}

	clearMeshes() {
		clearInterval(this.timer);
		this.timer = null;
		for (const { mesh } of this.trailMeshes)
			this.model.drop(mesh);
		this.trailMeshes = [];
		this.model.drop(this.robotMesh);
		this.robotMesh = null;
		this.animator = null;
	}

	onTfChange() {
		if (this.animator)
			this.show(this.animator.index);
	}

	onFixedFrameChange() {
		this.onTfChange();
	}

	onPropertyChange(key) {
		if (key === "description") {
			this.model.listen(this.props.description);
			return;
		}
		if (key === "topic") {
			this.clearMeshes();
			if (this.model.robot)
				this.robotMesh = this.model.mesh();
			this.points = [];
			this.applyLook();
			return;
		}
		if (key === "trail" || key === "trail_step") {
			this.buildTrail();
			if (this.animator)
				this.show(this.animator.index);
		}
		if ((key === "loop" || key === "display_time") && this.animator) {
			this.animator.loop = this.props.loop;
			this.animator.displayTime = stateDisplayTime(this.props.display_time);
			if (this.props.loop && !this.timer)
				this.run();
		}
		this.applyLook();
	}

	onDestroy() {
		clearInterval(this.timer);
		this.model.dispose();
	}
}
