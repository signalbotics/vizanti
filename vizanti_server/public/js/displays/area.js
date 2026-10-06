import { Display } from '../core/display.js';
import { boxPolygon } from '../geometry/waypoints.js';

// Drag an axis-aligned box on the ground and publish it as geometry_msgs/PolygonStamped in the
// fixed frame. Replaces the old 2D "area" widget and keeps its topic.
export class AreaDisplay extends Display {

	static type = "area";
	static label = "Bounding Box";
	static icon = "assets/area.svg";
	static description = "Drag a box on the ground and publish it as a geometry_msgs/PolygonStamped";

	static properties = {
		area_topic: { type: "string", label: "Topic", default: "/area", help: "Where the box is published, as geometry_msgs/PolygonStamped in the fixed frame." },
		color: { type: "color", label: "Colour", default: "#4fd68a" },
		box: { type: "array" }, // the last box sent, kept on screen
	};

	static migrateProps(props) {
		return props.state && typeof props.state === "object" && typeof props.state.topic === "string"
			? { area_topic: props.state.topic }
			: props;
	}

	onCreate() {
		this.drawing = false;
		this.start = null;
		this.preview = null;
		this.outline = this.ctx.scene.makeLines({ color: this.props.color, linewidth: 2 });
		this.add(this.outline);
		this.draw();
	}

	draw() {
		const corners = this.preview ?? (this.props.box.length === 4 ? this.props.box : null);
		if (!corners) {
			this.ctx.scene.setLinePositions(this.outline, []);
		} else {
			const line = [];
			for (let i = 0; i < 4; i++) {
				const a = corners[i], b = corners[(i + 1) % 4];
				line.push(a.x, a.y, 0.01, b.x, b.y, 0.01); // just above the ground
			}
			this.ctx.scene.setLinePositions(this.outline, line);
		}
		this.requestRender();
	}

	setDrawing(on) {
		this.drawing = on;
		this.start = null;
		this.preview = null;
		this.ctx.setPointerEditor?.(on ? this : null);
		this.draw();
		if (this.drawButton) {
			this.drawButton.classList.toggle("tool_active", on);
			this.drawButton.setAttribute("aria-pressed", String(on));
		}
	}

	onEditPointer(kind, { ground }) {
		if (kind === "down") {
			if (!ground)
				return false;
			this.start = ground;
			return true; // the drag draws the box instead of moving the camera
		}
		if (kind === "move" && this.start && ground) {
			this.preview = boxPolygon(this.start, ground);
			this.draw();
			return true;
		}
		if (kind === "up" && this.start) {
			const corners = ground ? boxPolygon(this.start, ground) : this.preview;
			if (corners && (corners[0].x !== corners[2].x || corners[0].y !== corners[2].y))
				this.send(corners);
			this.setDrawing(false);
			return true;
		}
		return false;
	}

	send(corners) {
		const ms = Date.now();
		this.ctx.publish(this.props.area_topic, "geometry_msgs/msg/PolygonStamped", {
			header: { stamp: { sec: Math.floor(ms / 1000), nanosec: (ms % 1000) * 1e6 }, frame_id: this.ctx.tf.fixed_frame },
			polygon: { points: corners },
		});
		this.setProp("box", corners);
		const w = Math.abs(corners[2].x - corners[0].x), h = Math.abs(corners[2].y - corners[0].y);
		this.setInfo({ "Last sent": `${w.toFixed(2)} × ${h.toFixed(2)} m box to ${this.props.area_topic}` });
		this.status.ok();
		this.draw();
	}

	buildCustomEditor(container) {
		this.drawButton = document.createElement("button");
		this.drawButton.type = "button";
		this.drawButton.textContent = "Draw box";
		this.drawButton.title = "Drag on the ground from one corner to the opposite one; the box is published when you let go.";
		this.drawButton.addEventListener("click", () => this.setDrawing(!this.drawing));
		const row = document.createElement("div");
		row.className = "waypoint_buttons";
		row.append(this.drawButton);
		container.append(row);
	}

	onPropertyChange(key, value) {
		if (key === "color")
			this.outline.material.color.set(value);
		this.draw();
	}

	_setEnabled(enabled) {
		if (!enabled && this.drawing)
			this.setDrawing(false);
		super._setEnabled(enabled);
	}

	onDestroy() {
		if (this.drawing)
			this.ctx.setPointerEditor?.(null);
	}
}
