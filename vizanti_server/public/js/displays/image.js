import { Display } from '../core/display.js';
import { imageToRGBA } from '../geometry/image.js';

// An uncompressed camera image, shown in a corner of the 3D view.
export class ImageDisplay extends Display {

	static type = "image";
	static label = "Image";
	static icon = "assets/image.svg";
	static description = "sensor_msgs/Image (uncompressed); use Compressed Image for compressed topics";
	static msgTypes = ["sensor_msgs/msg/Image"];

	static properties = {
		topic: {
			type: "topic", label: "Topic",
			help: "Raw images are large. Prefer the compressed topic over slow links, or raise the throttle.",
		},
		size: { type: "int", label: "Width on screen (px)", default: 320, min: 40, max: 4000 },
		corner: {
			type: "enum", label: "Position", default: "top-left",
			options: [
				{ value: "top-left", label: "Top left" }, { value: "top-right", label: "Top right" },
				{ value: "bottom-left", label: "Bottom left" }, { value: "bottom-right", label: "Bottom right" },
			],
		},
		opacity: { type: "float", label: "Opacity", default: 1.0, min: 0.1, max: 1, step: 0.05, slider: true },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 200, min: 0, max: 10000 },
	};

	get iconColor() {
		return null;
	}

	onCreate() {
		this.canvas = document.createElement("canvas");
		this.canvas.className = "image_display";
		this.canvas.style.display = "none";
		this.ctx.scene.container.appendChild(this.canvas);
		this.applyStyle();
	}

	applyStyle() {
		const style = this.canvas.style;
		const [vertical, horizontal] = this.props.corner.split("-");
		style.top = vertical === "top" ? "8px" : "auto";
		style.bottom = vertical === "bottom" ? "8px" : "auto";
		style.left = horizontal === "left" ? "8px" : "auto";
		style.right = horizontal === "right" ? "8px" : "auto";
		style.width = this.props.size + "px";
		style.opacity = this.props.opacity;
	}

	onMessage(msg) {
		const image = imageToRGBA(msg);
		if (image.error) {
			this.status.error(image.error);
			this.canvas.style.display = "none";
			return;
		}
		if (this.canvas.width !== image.width || this.canvas.height !== image.height) {
			this.canvas.width = image.width;
			this.canvas.height = image.height;
		}
		this.canvas.getContext("2d").putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
		this.canvas.style.display = this.enabled ? "block" : "none";
		this.setInfo({ "Frame": msg.header.frame_id, "Size": `${image.width} x ${image.height}`, "Encoding": msg.encoding });
	}

	_setEnabled(enabled) {
		super._setEnabled(enabled);
		if (!enabled)
			this.canvas.style.display = "none";
	}

	onPropertyChange(key) {
		if (key === "topic") {
			this.canvas.style.display = "none";
			this.setInfo({});
		}
		this.applyStyle();
	}

	onDestroy() {
		this.canvas.remove();
	}
}
