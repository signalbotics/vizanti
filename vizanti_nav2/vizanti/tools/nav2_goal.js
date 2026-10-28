// The Nav2 goal tool (nav2_rviz_plugins/GoalTool): press where the robot should go, drag to set
// its heading, release. The pose goes to an open Navigation 2 panel, which navigates to it or,
// in waypoint mode, adds it as a waypoint; with no panel open, it is sent as a NavigateToPose
// goal directly.
import { ToolPlugin } from '@vizanti/plugin_api.js';
import { handGoal } from '../nav2_bus.js';
import { poseStamped } from '../nav2_panel_logic.js';

export class Nav2GoalTool extends ToolPlugin {

	static key = "";
	static hint = "Press where the robot should go and drag to set its heading (Nav2).";

	onActivate() {
		this.start = null;
		this.yaw = 0;
	}

	onPointer(kind, event) {
		const here = this.api.ground(event.clientX, event.clientY);
		if (kind === "down") {
			this.start = here;
			this.yaw = 0;
			return;
		}
		if (!this.start)
			return;
		if (here && (here.x !== this.start.x || here.y !== this.start.y))
			this.yaw = Math.atan2(here.y - this.start.y, here.x - this.start.x);
		if (kind !== "up")
			return;
		const pose = { frame: this.api.fixedFrame(), x: this.start.x, y: this.start.y, yaw: this.yaw };
		this.start = null;
		if (!handGoal(pose)) {
			const now = Date.now();
			this.api.action("/navigate_to_pose", "nav2_msgs/action/NavigateToPose")
				.send({ pose: poseStamped(pose, { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1e6 }), behavior_tree: "" });
			this.api.notify("Nav2 goal sent (no Navigation 2 panel open)");
		}
		this.api.done();
	}

	// the arrow being dragged out, as RViz's goal tool draws it
	onOverlay(ctx, view) {
		if (!this.start)
			return;
		const length = 70 / view.pixelsPerMeter();
		const tail = view.project(this.start.x, this.start.y, 0);
		const tip = view.project(this.start.x + Math.cos(this.yaw) * length, this.start.y + Math.sin(this.yaw) * length, 0);
		const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
		ctx.strokeStyle = ctx.fillStyle = "#b04cff";
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(tail.x, tail.y);
		ctx.lineTo(tip.x, tip.y);
		ctx.stroke();
		ctx.beginPath();
		ctx.moveTo(tip.x + 14 * Math.cos(angle), tip.y + 14 * Math.sin(angle));
		ctx.lineTo(tip.x + 10 * Math.cos(angle + 2.4), tip.y + 10 * Math.sin(angle + 2.4));
		ctx.lineTo(tip.x + 10 * Math.cos(angle - 2.4), tip.y + 10 * Math.sin(angle - 2.4));
		ctx.fill();
	}
}
