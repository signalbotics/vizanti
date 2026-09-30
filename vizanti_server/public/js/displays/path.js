import { Display } from '../core/display.js';
import { pathSegments, pathLength, formatDistance } from '../geometry/shapes.js';

export class PathDisplay extends Display {

	static type = "path";
	static label = "Path";
	static icon = "assets/path.svg";
	static description = "Display a nav_msgs/Path.";
	static msgTypes = ["nav_msgs/msg/Path"];

	static properties = {
		topic: { type: "topic", label: "Topic" },
		color: { type: "color", label: "Colour", default: "#54db67" },
		opacity: { type: "float", label: "Opacity", default: 1.0, min: 0, max: 1, step: 0.05, slider: true },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 100, min: 0, max: 10000 },
	};

	onCreate() {
		this.lines = this.add(this.ctx.scene.makeLines({ color: this.props.color, linewidth: 2, opacity: this.props.opacity }));
		this.hasData = false;
	}

	applyVisibility() {
		this.lines.visible = this.hasData && this.props.opacity > 0;
	}

	onMessage(msg) {
		if (msg.poses === undefined) {
			this.status.warn("Received uninitialized list of poses. Wat.");
			return;
		}
		if (!this.setFrame(msg.header, { follow: true })) {
			this.hasData = false;
			this.applyVisibility();
			return;
		}

		const points = msg.poses.map((p) => p?.pose?.position);
		this.hasData = this.ctx.scene.setLinePositions(this.lines, pathSegments(points));
		this.applyVisibility();

		this.setInfo({
			"Frame": msg.header.frame_id,
			"Points": msg.poses.length,
			"Distance": formatDistance(pathLength(points)),
		});
	}

	onPropertyChange(key, value) {
		if (key === "color")
			this.lines.material.color.set(value);
		if (key === "opacity")
			this.lines.material.opacity = value;
		if (key === "topic") {
			this.hasData = false;
			this.setInfo({});
		}
		this.applyVisibility();
	}

	onDestroy() {
		this.ctx.scene.disposeLines(this.lines);
	}
}
