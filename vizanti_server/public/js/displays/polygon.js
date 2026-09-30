import { Display } from '../core/display.js';
import { loopSegments } from '../geometry/shapes.js';

export class PolygonDisplay extends Display {

	static type = "polygon";
	static label = "Polygon";
	static icon = "assets/area.svg";
	static description = "geometry_msgs/PolygonStamped as a closed outline, such as a robot footprint";
	static msgTypes = ["geometry_msgs/msg/PolygonStamped"];

	static properties = {
		topic: { type: "topic", label: "Topic" },
		color: { type: "color", label: "Colour", default: "#19ff00" },
		thickness: { type: "int", label: "Line thickness (px)", default: 2, min: 1, max: 20 },
		opacity: { type: "float", label: "Alpha", default: 1.0, min: 0.05, max: 1, step: 0.05, slider: true },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 100, min: 0, max: 10000 },
	};

	onCreate() {
		this.lines = this.add(this.ctx.scene.makeLines({ color: this.props.color, linewidth: this.props.thickness, opacity: this.props.opacity }));
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header, { follow: true })) {
			this.lines.visible = false;
			return;
		}
		const points = msg.polygon?.points ?? [];
		this.ctx.scene.setLinePositions(this.lines, loopSegments(points));
		this.setInfo({ "Frame": msg.header.frame_id, "Points": points.length });
	}

	onPropertyChange(key, value) {
		if (key === "color")
			this.lines.material.color.set(value);
		if (key === "thickness")
			this.lines.material.linewidth = value;
		if (key === "opacity")
			this.lines.material.opacity = value;
		if (key === "topic") {
			this.lines.visible = false;
			this.setInfo({});
		}
	}

	onDestroy() {
		this.ctx.scene.disposeLines(this.lines);
	}
}
