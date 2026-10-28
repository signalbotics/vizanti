// Example Vizanti display plugin: a text label that follows a TF frame.
//
// Declared in ../../vizanti_plugins.xml (exported from CMakeLists.txt with
// pluginlib_export_plugin_description_file), like an RViz plugin. Plugins import the framework
// through "@vizanti/". See docs/plugins.md in the vizanti repository.
import { Display } from '@vizanti/plugin_api.js';

export class FrameLabelDisplay extends Display {

	static properties = {
		frame: { type: "frame", label: "Frame" },
		text: { type: "string", label: "Text", default: "Hello from a plugin" },
		color: { type: "color", label: "Colour", default: "#ffd23f" },
		size: { type: "int", label: "Font size (px)", default: 18, min: 6, max: 96 },
	};

	onTfChange() {
		this.requestRender();
	}

	onOverlay(ctx, scene) {
		const pose = this.props.frame === "" ? { translation: { x: 0, y: 0, z: 0 } } : this.ctx.tf.absoluteTransforms[this.props.frame];
		if (!pose) {
			this.status.warn(`Transform to frame '${this.props.frame}' not yet available.`);
			return;
		}
		this.status.ok();
		const p = scene.project(pose.translation.x, pose.translation.y, pose.translation.z);
		if (!p.visible)
			return;
		ctx.font = `bold ${this.props.size}px Monospace`;
		ctx.textAlign = "center";
		ctx.lineWidth = 4;
		ctx.strokeStyle = "#161B21";
		ctx.fillStyle = this.props.color;
		ctx.strokeText(this.props.text, p.x, p.y - 20);
		ctx.fillText(this.props.text, p.x, p.y - 20);
	}
}
