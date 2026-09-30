import { Display } from '../core/display.js';
import { visibleFrames, tfGeometry, isStandardFrame } from '../geometry/tf.js';
import { groupStringsByPrefix } from '../modules/util.js';

export class TfDisplay extends Display {

	static type = "tf";
	static label = "TF";
	static icon = "assets/tf.svg";
	static description = "TF transform hierarchy";

	static properties = {
		show_names: { type: "bool", label: "Names", default: true },
		show_axes: { type: "bool", label: "Axes", default: true },
		show_lines: { type: "bool", label: "Lines", default: true },
		scale: { type: "float", label: "Scale", default: 1.0, min: 0.3, max: 2.5, step: 0.01, slider: true },
		frame_visibility: { type: "object", default: {} },
	};

	onCreate() {
		const scene = this.ctx.scene;
		this.links = this.add(scene.makeLines({ color: "#eba834", linewidth: this.props.scale }));
		this.axes = this.add(scene.makeLines({ vertexColors: true, linewidth: 2 * this.props.scale }));
		this.frames = new Set();
		this.labels = [];
		this.editor = null;
		this.receivedTf = false;

		// new frames are picked up once a second, as the current widget does
		this.timer = setInterval(() => this.refreshVisibility(), 1000);
		this.refreshVisibility();
		if (!this.receivedTf)
			this.status.warn("No TF data received yet.");
	}

	refreshVisibility() {
		const tf = this.ctx.tf;
		const visibility = { ...this.props.frame_visibility };
		const result = visibleFrames(tf.transforms, tf.absoluteTransforms, visibility);
		this.frames = result.frames;
		if (result.changed)
			this.props.frame_visibility = visibility; // saved with the next change
		this.rebuild();
	}

	rebuild() {
		const tf = this.ctx.tf;
		const scene = this.ctx.scene;
		const ppm = scene.pixelsPerMeter();
		if (!(ppm > 0))
			return;

		const geometry = tfGeometry(tf.transforms, tf.absoluteTransforms, this.frames, (30 * this.props.scale) / ppm);
		const hasAxes = scene.setLinePositions(this.axes, geometry.axes, geometry.colors);
		const hasLinks = scene.setLinePositions(this.links, geometry.links);
		this.axes.visible = hasAxes && this.props.show_axes;
		this.links.visible = hasLinks && this.props.show_lines;
		this.labels = geometry.labels;
		this.requestRender();
	}

	onTfChange() {
		this.receivedTf = true;
		this.status.ok();
		this.rebuild();
	}

	onFixedFrameChange() {
		this.rebuild();
	}

	onCameraChange() {
		this.rebuild(); // axis length is constant on screen, so it changes with zoom
	}

	onPropertyChange(key) {
		if (key === "scale") {
			this.axes.material.linewidth = 2 * this.props.scale;
			this.links.material.linewidth = this.props.scale;
		}
		if (key === "frame_visibility") {
			this.refreshVisibility();
			return;
		}
		this.rebuild();
	}

	onOverlay(ctx, scene) {
		if (!this.props.show_names)
			return;

		const scale = this.props.scale;
		ctx.lineJoin = "round";
		ctx.miterLimit = 2;
		ctx.font = (12 * scale) + "px Monospace";
		ctx.textAlign = "center";
		ctx.fillStyle = "white";
		ctx.strokeStyle = "#161B21";
		ctx.lineWidth = 5 * scale;

		for (const label of this.labels) {
			const point = scene.project(label.x, label.y, label.z);
			if (!point.visible)
				continue;
			ctx.strokeText(label.name, point.x, point.y + 15);
			ctx.fillText(label.name, point.x, point.y + 15);
		}
	}

	onDestroy() {
		clearInterval(this.timer);
		this.ctx.scene.disposeLines(this.axes);
		this.ctx.scene.disposeLines(this.links);
	}

	// ---- per-frame visibility list ----

	setVisibility(change) {
		const visibility = { ...this.props.frame_visibility };
		change(visibility);
		this.setProp("frame_visibility", visibility);
	}

	buildCustomEditor(container) {
		const tf = this.ctx.tf;

		const heading = document.createElement("b");
		heading.textContent = "Frames:";
		container.appendChild(heading);

		const buttons = document.createElement("div");
		const bulk = (text, colour, change) => {
			const element = document.createElement("button");
			element.textContent = text;
			element.style.backgroundColor = colour;
			element.addEventListener("click", () => {
				this.setVisibility(change);
				renderList();
			});
			buttons.appendChild(element);
		};
		bulk("Enable All", "#2f4d26", (v) => { for (const key of Object.keys(v)) v[key] = true; });
		bulk("Standard Only", "#5e602c", (v) => {
			for (const key of Object.keys(v))
				v[key] = tf.transforms[key] === undefined || isStandardFrame(key); // frames with no parent are origins
		});
		bulk("Disable All", "#4d2626", (v) => { for (const key of Object.keys(v)) v[key] = false; });
		container.appendChild(buttons);

		const list = document.createElement("div");
		container.appendChild(list);

		const span = (parent, text, colour) => {
			const element = document.createElement("span");
			if (colour)
				element.style.color = colour;
			element.textContent = text;
			parent.appendChild(element);
		};

		const entry = (key) => {
			const row = document.createElement("div");
			row.classList.add("tf_label");

			const checkbox = document.createElement("input");
			checkbox.type = "checkbox";
			checkbox.checked = this.props.frame_visibility[key] !== false;
			checkbox.addEventListener("change", () => this.setVisibility((v) => { v[key] = checkbox.checked; }));

			const label = document.createElement("label");
			span(label, ` ${key} `, "white");
			const frame = tf.transforms[key];
			if (frame !== undefined) {
				span(label, `← ${frame.parent} `, "darkgray");
				span(label, "(", "darkgray");
				span(label, frame.translation.x.toFixed(2), "#ff6666");
				span(label, " ", null);
				span(label, frame.translation.y.toFixed(2), "#66cc66");
				span(label, " ", null);
				span(label, frame.translation.z.toFixed(2), "#9aacc3ff");
				span(label, ")", "darkgray");
			} else {
				span(label, "(origin)", "darkgray");
			}

			row.append(checkbox, label);
			return row;
		};

		const renderList = () => {
			const names = new Set();
			for (const child of Object.keys(tf.transforms)) {
				names.add(child);
				names.add(tf.transforms[child].parent);
			}

			list.replaceChildren();
			for (const group of groupStringsByPrefix([...names], 2)) {
				if (group.length === 1) {
					list.appendChild(entry(group[0]));
				} else {
					const details = document.createElement("details");
					details.open = true;
					details.classList.add("tf_details");
					const summary = document.createElement("summary");
					summary.classList.add("tf_summary");
					summary.textContent = group[0].replace(/_+$/, "");
					details.appendChild(summary);
					for (let i = 1; i < group.length; i++)
						details.appendChild(entry(group[i]));
					list.appendChild(details);
				}
			}
		};

		renderList();
	}
}
