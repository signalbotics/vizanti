import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { makeArrow, aimAlong, disposeObject } from '../core/arrow.js';

// Solid X (red), Y (green), Z (blue) axes at one TF frame.
export class AxesDisplay extends Display {

	static type = "axes";
	static label = "Axes";
	static icon = "assets/tf.svg";
	static description = "Red, green and blue axes at a TF frame";

	static properties = {
		frame: { type: "frame", label: "Reference frame" },
		length: { type: "float", label: "Length (m)", default: 1.0, min: 0.01, max: 1000, step: 0.01 },
		radius: { type: "float", label: "Radius (m)", default: 0.05, min: 0.001, max: 100, step: 0.005 },
		opacity: { type: "float", label: "Alpha", default: 1.0, min: 0.05, max: 1, step: 0.05, slider: true },
	};

	get iconColor() {
		return null;
	}

	onCreate() {
		this.axes = new THREE.Group();
		this.add(this.axes);
		this.rebuild();
		this.place();
	}

	rebuild() {
		disposeObject(this.axes);
		this.axes.clear();
		const { length, radius, opacity } = this.props;
		for (const [color, x, y, z] of [["#e0000b", 1, 0, 0], ["#29ff26", 0, 1, 0], ["#0084ff", 0, 0, 1]]) {
			const material = new THREE.MeshLambertMaterial({ color, opacity, transparent: opacity < 1 });
			const arrow = makeArrow(length, radius, radius * 2, Math.min(radius * 5, length * 0.3), material);
			aimAlong(arrow, x, y, z);
			arrow.traverse((object) => { object.renderOrder = this.order; });
			this.axes.add(arrow);
		}
	}

	place() {
		const node = this.ctx.frames.get(this.props.frame);
		if (!node) {
			this.axes.visible = false;
			this.status.warn(`Transform to frame '${this.props.frame}' not yet available.`);
			return;
		}
		if (this.root.parent !== node)
			node.add(this.root);
		this.axes.visible = true;
		this.status.ok();
	}

	onTfChange() {
		if (!this.axes.visible)
			this.place();
	}

	onFixedFrameChange() {
		this.place();
	}

	onPropertyChange(key) {
		if (key === "frame")
			this.place();
		else
			this.rebuild();
	}

	onDestroy() {
		disposeObject(this.axes);
	}
}
