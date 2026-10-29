// The RobotState display (moveit_rviz_plugin/RobotState) for Vizanti: the robot in the state a
// moveit_msgs/DisplayRobotState gives (not its TF), with the highlighted links in their colours.
import { Display } from '@vizanti/plugin_api.js';
import { MoveItRobot } from '../moveit_robot.js';
import { defaultPositions, applyRobotState, isEmptyState, highlightMap } from '../moveit_state_logic.js';

export class RobotStateDisplay extends Display {

	static msgTypes = ["moveit_msgs/msg/DisplayRobotState"];

	static properties = {
		description: { type: "string", label: "Robot Description", default: "/robot_description", help: "The topic with the robot's URDF (std_msgs/String)." },
		topic: { type: "topic", label: "Robot State Topic", default: "/display_robot_state" },
		alpha: { type: "float", label: "Robot Alpha", default: 1, min: 0, max: 1, step: 0.05, slider: true, help: "Specifies the alpha for the robot links" },
		show_highlights: { type: "bool", label: "Show Highlights", default: true, help: "Specifies whether link highlighting is enabled" },
		visual: { type: "bool", label: "Visual Enabled", default: true, help: "Whether to display the visual representation of the robot." },
		collision: { type: "bool", label: "Collision Enabled", default: false, help: "Whether to display the collision representation of the robot." },
	};

	static fromRviz(entry) {
		const props = {};
		const topic = entry?.["Robot State Topic"]?.Value ?? entry?.["Robot State Topic"];
		if (typeof topic === "string" && topic)
			props.topic = topic.startsWith("/") ? topic : `/${topic}`;
		const description = entry?.["Robot Description"];
		if (typeof description === "string" && description)
			props.description = description.startsWith("/") ? description : `/${description}`;
		if (Number.isFinite(Number(entry?.["Robot Alpha"])))
			props.alpha = Number(entry["Robot Alpha"]);
		for (const [key, rviz] of [["show_highlights", "Show Highlights"], ["visual", "Visual Enabled"], ["collision", "Collision Enabled"]])
			if (typeof entry?.[rviz] === "boolean")
				props[key] = entry[rviz];
		return props;
	}

	onCreate() {
		this.positions = {};
		this.received = false;
		this.hidden = true; // until a state arrives
		this.highlights = new Map();
		this.mesh = null;
		this.model = new MoveItRobot(this, (robot) => {
			this.model.drop(this.mesh);
			this.mesh = this.model.mesh();
			this.positions = defaultPositions(robot);
			this.applyLook();
			this.update();
		});
		this.model.listen(this.props.description);
		this.status.warn("No msg received");
	}

	onMessage(msg) {
		if (!this.model.robot)
			return;
		if (!isEmptyState(msg.state))
			this.positions = applyRobotState(this.model.robot, this.positions, msg.state);
		this.highlights = highlightMap(msg.highlight_links);
		this.received = true;
		this.hidden = !!msg.hide;
		this.applyLook();
		this.update();
	}

	update() {
		if (!this.mesh)
			return;
		const placed = this.model.pose(this.mesh, this.positions);
		this.mesh.group.visible = placed && !this.hidden;
		this.report(placed);
		this.requestRender();
	}

	report(placed) {
		const { pending, failed } = this.model.meshReport();
		this.setInfo({ "Robot": this.model.robot.name || "(unnamed)", "Root link": this.model.robot.root ?? "", "Meshes loading": pending });
		if (failed.length)
			this.status.error(`${failed.length} mesh(es) could not be loaded, first: ${failed[0]}`);
		else if (!placed)
			this.status.warn(`No transform from the root link '${this.model.robot.root}' to the fixed frame.`);
		else if (this.hidden)
			this.status.warn(this.received ? "Hidden" : "No msg received");
		else
			this.status.ok();
	}

	applyLook() {
		if (!this.mesh)
			return;
		this.mesh.setVisibility(this.props.visual, this.props.collision);
		this.mesh.linkColors = this.props.show_highlights ? new Map(this.highlights) : new Map();
		this.mesh.setOpacity(this.props.alpha); // applies the colours too
	}

	onTfChange() {
		if (this.mesh)
			this.update();
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
			this.received = false;
			this.hidden = true;
		}
		this.applyLook();
		this.update();
	}

	onDestroy() {
		this.model.dispose();
	}
}
