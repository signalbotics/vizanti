// Example Vizanti panel plugin: the last messages of a std_msgs/String topic, newest first.
// A panel is a dock panel in the RViz UI (Panels → Add panel) and an icon in the touch UI.
import { PanelPlugin, WIDGET_PROPERTIES } from '@vizanti/plugin_api.js';

export class TextLogPanel extends PanelPlugin {

	static msgTypes = ["std_msgs/msg/String"];
	static properties = {
		topic: { type: "topic", label: "Topic", default: "/chatter" },
		lines: { type: "int", label: "Lines kept", default: 50, min: 1, max: 1000 },
		...WIDGET_PROPERTIES,
	};

	onCreate() {
		this.log = [];
	}

	onMessage(msg) {
		const time = new Date().toLocaleTimeString();
		this.log.unshift(`${time}  ${msg.data}`);
		this.log.length = Math.min(this.log.length, this.props.lines);
		this.paint();
	}

	onPropertyChange(key) {
		if (key === "topic")
			this.log = [];
		this.paint();
	}

	buildPanel(container) {
		this.list = document.createElement("pre");
		this.list.className = "inspector_echo";
		container.appendChild(this.list);
		this.paint();
	}

	paint() {
		if (this.list)
			this.list.textContent = this.log.length ? this.log.join("\n") : `Waiting for ${this.props.topic}…`;
	}
}
