import * as THREE from '../lib/three.module.min.js';
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
			help: "The grid is drawn in a plane of the selected frame (XY unless set below).",
		},
		plane: {
			type: "enum", label: "Plane", default: "XY",
			options: ["XY", "XZ", "YZ"],
		},
		offset: {
			type: "group", label: "Offset (m, in the frame)", properties: {
				offset_x: { type: "float", label: "X", default: 0, step: 0.1 },
				offset_y: { type: "float", label: "Y", default: 0, step: 0.1 },
				offset_z: { type: "float", label: "Z", default: 0, step: 0.1 },
			},
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
		// the lines live in the grid's own plane, placed in the frame by plane and offset
		this.plane = this.add(new THREE.Group());
		this.subLines = scene.makeLines({ color: this.props.colour_sub, linewidth: 1, opacity: 0.65 });
		this.mainLines = scene.makeLines({ color: this.props.colour, linewidth: this.props.thickness });
		for (const lines of [this.subLines, this.mainLines]) {
			lines.renderOrder = this.order;
			this.plane.add(lines);
		}
		this.placePlane();
		this.step = this.props.size;
		this.key = null;
		this.rebuild();
	}

	// Grid lines are built in the plane group's own XY; its basis maps them onto the chosen plane.
	placePlane() {
		const axes = {
			XY: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
			XZ: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
			YZ: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
		}[this.props.plane] ?? [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
		const [x, y, z] = axes.map((a) => new THREE.Vector3(...a));
		this.plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
		this.plane.position.set(this.props.offset_x, this.props.offset_y, this.props.offset_z);
		this.key = null;
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

		// the view centre expressed in the grid's own plane
		this.plane.updateWorldMatrix(true, false);
		const centre = this.plane.worldToLocal(scene.viewTarget());
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
		if (["plane", "offset_x", "offset_y", "offset_z"].includes(key))
			this.placePlane();
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
