// MoveIt's Trajectory display without the page: a moveit_msgs/DisplayTrajectory turned into
// waypoints, and the animation's clock (TrajectoryVisualization::update). Pure.
import { applyRobotState } from './moveit_state_logic.js';

const seconds = (d) => (d ? (d.sec ?? 0) + (d.nanosec ?? 0) / 1e9 : 0);

// "3x" -> -3 (a factor of the trajectory's own timing), "0.1s" -> 0.1 (fixed time per waypoint);
// anything else is the default "3x" (getStateDisplayTime)
export function stateDisplayTime(text) {
	const t = String(text ?? "").trim();
	const unit = t.slice(-1);
	const value = Number(t.slice(0, -1).trim());
	if ((unit !== "x" && unit !== "s") || !Number.isFinite(value) || value <= 0)
		return -3;
	return unit === "x" ? -value : value;
}

// DisplayTrajectory -> [{ positions, dt }] (dt: seconds since the previous waypoint). The first
// segment starts from trajectory_start; each later one from the last waypoint before it.
export function waypoints(robot, base, msg) {
	let current = applyRobotState(robot, base, msg?.trajectory_start);
	const out = [];
	for (const segment of msg?.trajectory ?? []) {
		const jt = segment.joint_trajectory ?? {};
		const names = jt.joint_names ?? [];
		let previous = 0;
		for (const point of jt.points ?? []) {
			const positions = { ...current };
			names.forEach((name, i) => {
				if (Number.isFinite(point.positions?.[i]))
					positions[name] = point.positions[i];
			});
			const t = seconds(point.time_from_start);
			out.push({ positions, dt: Math.max(0, t - previous) });
			previous = t;
			current = positions;
		}
	}
	return out;
}

// The animation: which waypoint shows after `elapsed` more seconds.
//   new Animator(points, { displayTime, loop }); a.step(dt) -> { index, done, changed }
export class Animator {

	constructor(points, { displayTime = -3, loop = false } = {}) {
		this.points = points;
		this.displayTime = displayTime;
		this.loop = loop;
		this.restart();
	}

	restart() {
		this.index = 0;
		this.time = 0;
		this.done = this.points.length === 0;
	}

	step(dt) {
		if (this.done) {
			if (!this.loop || this.points.length === 0)
				return { index: Math.max(0, this.points.length - 1), done: true, changed: false };
			this.restart();
			return { index: 0, done: false, changed: true };
		}
		const before = this.index;
		this.time += dt;
		const count = this.points.length;
		if (this.displayTime < 0) {
			const factor = -this.displayTime;
			while (this.index < count - 1 && this.points[this.index + 1].dt / factor < this.time) {
				this.time -= this.points[this.index + 1].dt / factor;
				this.index++;
			}
			if (this.index === count - 1 && this.time > 0)
				this.done = true; // the last waypoint has been shown
		} else if (this.time > this.displayTime) {
			this.time = 0;
			if (this.index < count - 1)
				this.index++;
			else
				this.done = true;
		}
		return { index: this.index, done: this.done, changed: this.index !== before };
	}
}

// which trail copies are shown when the animation is at `index` (every `step`-th waypoint, and
// only those already passed), as RViz's trail
export function trailIndices(count, step) {
	const out = [];
	const s = Math.max(1, Math.floor(step));
	for (let i = 0; i * s < count + s - 1; i++)
		out.push(Math.min(count - 1, i * s));
	return [...new Set(out)];
}
