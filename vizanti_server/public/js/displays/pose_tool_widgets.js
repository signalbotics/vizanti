import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

// A widget-bar button for one of the view's pose tools with its own topic: a click arms the tool
// (as the toolbar does), and the pose dragged out next goes to this widget's topic. Several
// of them can drive several robots.
class PoseToolWidget extends WidgetDisplay {

	static tool = "";
	static topicKey = "";

	// the old template widget saved { state: { topic } }
	static migrateProps(props) {
		return props.state ? { topic: props.state.topic ?? "" } : props;
	}

	get iconColor() {
		return null;
	}

	// it only publishes
	get subscribes() {
		return false;
	}

	onCreate() {
		this.paintStatus();
	}

	onPropertyChange() {
		this.paintStatus();
	}

	paintStatus() {
		if (this.props.topic)
			this.status.ok();
		else
			this.status.error("No topic chosen.");
	}

	onIconClick() {
		if (!this.props.topic) {
			this.togglePanel(true);
			return;
		}
		const { tool, topicKey } = this.constructor;
		this.ctx.selectTool?.(tool, { [topicKey]: this.props.topic });
	}

	buildPanel(container) {
		const note = document.createElement("p");
		note.className = "comment";
		note.textContent = this.constructor.usage;
		const arm = document.createElement("button");
		arm.type = "button";
		arm.textContent = "Set pose in the view";
		arm.addEventListener("click", () => this.onIconClick());
		container.append(note, arm);
	}
}

export class SimpleGoalWidget extends PoseToolWidget {
	static type = "simplegoal";
	static label = "2D Nav Goal";
	static icon = "assets/simplegoal.svg";
	static description = "Button that sends a navigation goal (geometry_msgs/PoseStamped) to its own topic";
	static msgTypes = ["geometry_msgs/msg/PoseStamped"];
	static tool = "goal";
	static topicKey = "goal_topic";
	static usage = "Click the icon, then press where the robot should go and drag to set its heading. The goal is published once.";
	static properties = {
		topic: { type: "topic", label: "Topic", default: "/goal_pose" },
		...WIDGET_PROPERTIES,
	};
}

export class InitialPoseWidget extends PoseToolWidget {
	static type = "initialpose";
	static label = "2D Pose Estimate";
	static icon = "assets/initialpose.svg";
	static description = "Button that sends a pose estimate (geometry_msgs/PoseWithCovarianceStamped) to its own topic";
	static msgTypes = ["geometry_msgs/msg/PoseWithCovarianceStamped"];
	static tool = "estimate";
	static topicKey = "estimate_topic";
	static usage = "Click the icon, then press where the robot is and drag to set its heading. The estimate is published once.";
	static properties = {
		topic: { type: "topic", label: "Topic", default: "/initialpose" },
		...WIDGET_PROPERTIES,
	};
}
