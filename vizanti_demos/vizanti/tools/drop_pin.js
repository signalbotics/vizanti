// Example Vizanti tool plugin: click the ground to drop a pin; each pin is published as a
// geometry_msgs/PointStamped on /dropped_pins and drawn until the tool is used again with Shift.
// Add it to the RViz UI's toolbar with the "+" after the tools.
import { ToolPlugin } from '@vizanti/plugin_api.js';

export class DropPinTool extends ToolPlugin {

	static key = "i";
	static hint = "Click the ground to drop a pin (Shift + click clears them).";

	constructor(api) {
		super(api);
		this.pins = [];
	}

	onPointer(kind, event) {
		if (kind !== "up")
			return;
		if (event.shiftKey) {
			this.pins = [];
			return;
		}
		const point = this.api.ground(event.clientX, event.clientY);
		if (!point)
			return;
		this.pins.push(point);
		this.api.publish("/dropped_pins", "geometry_msgs/msg/PointStamped", { header: this.api.header(), point });
		this.api.notify(`Pin ${this.pins.length} at ${point.x.toFixed(2)}, ${point.y.toFixed(2)}`);
	}

	onOverlay(ctx, view) {
		ctx.fillStyle = "#ff5a5f";
		ctx.strokeStyle = "#161B21";
		ctx.lineWidth = 2;
		this.pins.forEach((pin, i) => {
			const p = view.project(pin.x, pin.y, pin.z);
			if (!p.visible)
				return;
			ctx.beginPath();
			ctx.arc(p.x, p.y - 14, 7, 0, 2 * Math.PI);
			ctx.moveTo(p.x, p.y);
			ctx.lineTo(p.x, p.y - 8);
			ctx.fill();
			ctx.stroke();
			ctx.font = "bold 12px Monospace";
			ctx.fillStyle = "white";
			ctx.fillText(String(i + 1), p.x + 10, p.y - 18);
			ctx.fillStyle = "#ff5a5f";
		});
	}
}
