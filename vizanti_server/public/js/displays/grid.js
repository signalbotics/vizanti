import { Display } from '../core/display.js';
import { fitGrid, gridLines, scaleLabel } from '../geometry/grid.js';

export class GridDisplay extends Display {

	static type = "grid";
	static label = "Grid";
	static icon = "assets/grid.svg";
	static description = "Infinite grid centered at the origin of the target frame of reference";

	static properties = {
		frame: {
			type: "frame", label: "Frame",
			help: "The grid is rendered in the XY plane of the selected frame.",
		},
		autoscale: {
			type: "enum", label: "Autoscale", default: "Coarse",
			options: ["Off", "Rough", "Coarse", "Fine", "Very Fine"],
			help: "If autoscale is off, the fixed size grid will stop rendering when the line density gets too high (to prevent lag).",
		},
		style: {
			type: "group", label: "Style and Size", properties: {
				size: { type: "float", label: "Step (meter)", default: 1.0, min: 0.01, max: 1000000, step: 0.01 },
				thickness: { type: "int", label: "Line thickness (px)", default: 1, min: 1, max: 20 },
				colour: { type: "color", label: "Color", default: "#3e556a" },
			},
		},
		subdivision: {
			type: "group", label: "Subdivision Style", properties: {
				subdivisions: { type: "int", label: "Number of subcells per cell", default: 2, min: 1, max: 20 },
				colour_sub: { type: "color", label: "Color", default: "#294056" },
			},
		},
	};

	onCreate() {
		const scene = this.ctx.scene;
		this.subLines = this.add(scene.makeLines({ color: this.props.colour_sub, linewidth: 1, opacity: 0.65 }));
		this.mainLines = this.add(scene.makeLines({ color: this.props.colour, linewidth: this.props.thickness }));
		this.step = this.props.size;
		this.key = null;
		this.rebuild();
	}

	hide() {
		this.mainLines.visible = false;
		this.subLines.visible = false;
		this.key = null;
	}

	rebuild() {
		const scene = this.ctx.scene;
		const node = this.ctx.frames.get(this.props.frame);
		if (!node) {
			this.hide();
			this.status.warn(`Transform to frame '${this.props.frame}' not yet available.`);
			return;
		}
		if (this.root.parent !== node)
			node.add(this.root);

		const ppm = scene.pixelsPerMeter();
		if (!(ppm > 0))
			return;

		const radius = scene.viewRadiusMeters();
		const fit = fitGrid({
			step: this.props.size,
			subdivisions: this.props.subdivisions,
			autoscale: this.props.autoscale,
			visibleMeters: Math.min(scene.width, scene.height) / ppm,
			radius,
		});
		this.step = fit.step;

		if (fit.tooDense) {
			this.hide();
			this.status.warn("Too many lines to render, increase step size");
			return;
		}

		// the view centre expressed in the grid's own frame
		node.updateWorldMatrix(true, false);
		const centre = node.worldToLocal(scene.viewTarget());
		const ci = Math.round(centre.x / fit.step);
		const cj = Math.round(centre.y / fit.step);
		const n = Math.ceil(radius / fit.step) + 1;

		// panning inside one cell changes nothing, so skip the rebuild
		const key = `${fit.step}|${fit.subdivisions}|${ci}|${cj}|${n}`;
		if (key !== this.key) {
			this.key = key;
			const lines = gridLines({ step: fit.step, subdivisions: fit.subdivisions, ci, cj, n });
			scene.setLinePositions(this.mainLines, lines.main);
			scene.setLinePositions(this.subLines, lines.sub);
		}
		this.status.ok();
	}

	onPropertyChange(key, value) {
		if (key === "colour")
			this.mainLines.material.color.set(value);
		if (key === "colour_sub")
			this.subLines.material.color.set(value);
		if (key === "thickness")
			this.mainLines.material.linewidth = value;
		this.key = null;
		this.rebuild();
	}

	onCameraChange() {
		this.rebuild();
	}

	onTfChange() {
		if (this.props.frame !== "")
			this.rebuild();
	}

	onFixedFrameChange() {
		this.key = null;
		this.rebuild();
	}

	// scale bar, bottom right, in the top-down view with autoscale on
	onOverlay(ctx, scene) {
		if (this.props.autoscale === "Off" || scene.mode !== "topdown" || !this.mainLines.visible)
			return;

		const wid = scene.width;
		const hei = scene.height;
		const xoffset = wid < hei ? 40 : 100;
		const yoffset = 40;
		const length = this.step * scene.pixelsPerMeter();
		const start = Math.round(wid - xoffset - length);
		const end = wid - xoffset;
		const y = hei - yoffset;

		ctx.strokeStyle = this.props.colour;
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(start, y);
		ctx.lineTo(end, y);
		ctx.moveTo(start, y - 5);
		ctx.lineTo(start, y + 5);
		ctx.moveTo(end, y - 5);
		ctx.lineTo(end, y + 5);
		ctx.stroke();

		ctx.font = "16px Monospace";
		ctx.textAlign = "center";
		ctx.fillStyle = this.props.colour;
		ctx.fillText(scaleLabel(this.step), Math.round(start + length / 2), hei - 23);
	}

	onDestroy() {
		this.ctx.scene.disposeLines(this.mainLines);
		this.ctx.scene.disposeLines(this.subLines);
	}
}
