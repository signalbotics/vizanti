import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { decodeCloud, colorizeValues, axisValues } from '../geometry/pointcloud.js';

const COLOUR_MODES = [
	{ value: "rgb", label: "RGB (from the cloud, else flat)" },
	{ value: "flat", label: "Flat colour" },
	{ value: "channel", label: "Channel (e.g. intensity)" },
	{ value: "axis_z", label: "Height (Z in the fixed frame)" },
	{ value: "axis_x", label: "X in the fixed frame" },
	{ value: "axis_y", label: "Y in the fixed frame" },
];

// a soft-edged white disc, used as the alpha of "circles" points
function circleTexture() {
	const size = 32;
	const data = new Uint8Array(size * size * 4);
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			const dx = x + 0.5 - size / 2, dy = y + 0.5 - size / 2;
			const inside = Math.hypot(dx, dy) <= size / 2 - 1;
			data.set([255, 255, 255, inside ? 255 : 0], (y * size + x) * 4);
		}
	}
	const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
	texture.needsUpdate = true;
	return texture;
}

export class PointCloudDisplay extends Display {

	static type = "pointcloud";
	static label = "Point Cloud";
	static icon = "assets/pointcloud.svg";
	static description = "sensor_msgs/PointCloud2";
	static msgTypes = ["sensor_msgs/msg/PointCloud2"];

	static properties = {
		topic: { type: "topic", label: "Topic" },
		style: {
			type: "enum", label: "Style", default: "squares",
			options: [
				{ value: "squares", label: "Squares (size in metres)" },
				{ value: "circles", label: "Circles (size in metres)" },
				{ value: "pixels", label: "Points (size in pixels)" },
			],
		},
		thickness: { type: "float", label: "Thickness (m)", default: 0.02, min: 0.01, max: 0.5, step: 0.01, slider: true },
		pixel_size: { type: "int", label: "Point size (px)", default: 3, min: 1, max: 20, help: "Used by the Points style." },
		max_points: { type: "int", label: "Max Points", default: 15000, min: 100, max: 500000, step: 100 },
		opacity: { type: "float", label: "Opacity", default: 1.0, min: 0.1, max: 1, step: 0.05, slider: true },
		decay_ms: {
			type: "int", label: "Decay time (ms)", default: 0, min: 0, max: 60000, step: 100,
			help: "Keep each cloud on screen this long, where it was measured, so a moving sensor leaves a trail. 0 shows only the latest cloud.",
		},
		colours: {
			type: "group", label: "Colour Config", properties: {
				colour_mode: { type: "enum", label: "Colour by", default: "rgb", options: COLOUR_MODES },
				channel: {
					type: "string", label: "Channel", default: "intensity",
					suggestions: ["intensity", "reflectivity", "ring", "range", "ambient", "t"],
					help: "The cloud field used by the Channel colour mode; values are spread over a blue (low) to red (high) rainbow.",
				},
				color: { type: "color", label: "Flat Colour", default: "#1f8eec", help: "Used by the Flat mode, and by RGB when the cloud has no rgb field." },
				// kept so older layouts and imported .rviz configs keep their flat colour
				colour_override: { type: "bool", label: "Override RGB with flat colour", default: false, hidden: true },
			},
		},
		throttle: {
			type: "int", label: "Socket throttle (ms)", default: 1000, min: 0, max: 10000,
			help: "Point clouds are very high bandwidth topics, and as such can easily cause TCP congestion. Lower the socket throttle time to get faster data updates over high bandwidth connections.",
		},
	};

	onCreate() {
		this.material = new THREE.PointsMaterial({ color: this.props.color, opacity: this.props.opacity, transparent: true, depthWrite: false });
		this.circle = null;
		this.clouds = []; // { points, matrix (cloud frame -> fixed frame when it arrived), time }
		this.lastCloudMsg = null;
		this.applyStyle();
		this.decayTimer = setInterval(() => this.expire(), 250);
	}

	mode() {
		return this.props.colour_override ? "flat" : this.props.colour_mode;
	}

	applyStyle() {
		const circles = this.props.style === "circles";
		if (circles && !this.circle)
			this.circle = circleTexture();
		this.material.alphaMap = circles ? this.circle : null;
		this.material.alphaTest = circles ? 0.5 : 0;
		this.material.needsUpdate = true;
		this.applySize();
	}

	applySize() {
		const size = this.props.style === "pixels"
			? { size: this.props.pixel_size, sizeAttenuation: false }
			: this.ctx.scene.pointSize(this.props.thickness);
		this.material.size = size.size;
		if (this.material.sizeAttenuation !== size.sizeAttenuation) {
			this.material.sizeAttenuation = size.sizeAttenuation;
			this.material.needsUpdate = true;
		}
	}

	// per-point colours for every mode except flat (and RGB on a cloud without rgb)
	applyColour(useVertex) {
		if (this.material.vertexColors !== useVertex) {
			this.material.vertexColors = useVertex;
			this.material.needsUpdate = true;
		}
		this.material.color.set(useVertex ? "#ffffff" : this.props.color);
	}

	// Positions and colours for one message, in the cloud's frame. root must already be placed.
	build(msg) {
		const mode = this.mode();
		const cloud = decodeCloud(msg, this.props.max_points, { channel: mode === "channel" ? this.props.channel : "" });
		if (cloud.error)
			return { error: cloud.error };

		let colors = null;
		let note = "flat";
		if (mode === "rgb" && cloud.colors) {
			colors = cloud.colors;
			note = "RGB";
		} else if (mode === "channel") {
			if (cloud.values) {
				const range = cloud.range ?? { min: 0, max: 0 };
				colors = colorizeValues(cloud.values, range.min, range.max);
				note = `${this.props.channel} ${range.min.toFixed(2)}…${range.max.toFixed(2)}`;
			} else {
				note = `no "${this.props.channel}" field, flat`;
			}
		} else if (mode.startsWith("axis_")) {
			const axis = mode.slice(5);
			this.root.updateMatrix();
			const values = axisValues(cloud.positions, this.root.matrix.elements, axis);
			let min = Infinity, max = -Infinity;
			for (const v of values) {
				if (v < min) min = v;
				if (v > max) max = v;
			}
			colors = colorizeValues(values, min, max);
			note = values.length ? `${axis} ${min.toFixed(2)}…${max.toFixed(2)} m` : axis;
		}
		return { cloud, colors, note };
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header)) {
			this.clear();
			return;
		}
		const built = this.build(msg);
		if (built.error) {
			this.status.error(built.error);
			this.clear();
			return;
		}
		this.lastCloudMsg = msg;
		const { cloud, colors, note } = built;
		this.applyColour(!!colors);
		if (this.mode() === "channel" && !cloud.values)
			this.status.warn(`The cloud has no "${this.props.channel}" field; drawn in the flat colour.`);

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
		if (colors)
			geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

		this.root.updateMatrix();
		const matrix = this.root.matrix.clone();
		if (this.props.decay_ms > 0) {
			const points = new THREE.Points(geometry, this.material);
			points.frustumCulled = false;
			points.matrixAutoUpdate = false;
			this.add(points);
			this.clouds.push({ points, matrix, time: performance.now() });
			this.expire();
			this.placeTrail();
		} else {
			this.clear();
			const points = new THREE.Points(geometry, this.material);
			points.frustumCulled = false;
			this.add(points);
			this.clouds.push({ points, matrix, time: performance.now() });
		}

		this.setInfo({
			"Frame": msg.header.frame_id,
			"Points": msg.width * msg.height,
			"Shown": cloud.count,
			"Colour": note,
			...(this.props.decay_ms > 0 ? { "Clouds kept": this.clouds.length } : {}),
		});
	}

	// Older clouds keep the pose they had when they arrived: root has moved to the newest
	// cloud's pose, so each one gets root^-1 * (its own pose).
	placeTrail() {
		const inverse = this.root.matrix.clone().invert();
		for (const entry of this.clouds) {
			entry.points.matrix.multiplyMatrices(inverse, entry.matrix);
			entry.points.matrixWorldNeedsUpdate = true;
		}
	}

	expire() {
		if (!this.clouds || this.props.decay_ms <= 0 || this.clouds.length <= 1)
			return;
		const now = performance.now();
		let removed = false;
		// the newest cloud always stays
		while (this.clouds.length > 1 && now - this.clouds[0].time > this.props.decay_ms) {
			const { points } = this.clouds.shift();
			points.removeFromParent();
			points.geometry.dispose();
			removed = true;
		}
		if (removed)
			this.requestRender();
	}

	clear() {
		for (const { points } of this.clouds) {
			points.removeFromParent();
			points.geometry.dispose();
		}
		this.clouds = [];
	}

	onPropertyChange(key) {
		if (key === "opacity")
			this.material.opacity = this.props.opacity;
		if (key === "thickness" || key === "pixel_size")
			this.applySize();
		if (key === "style")
			this.applyStyle();
		if (["colour_mode", "channel", "color", "colour_override", "decay_ms", "max_points"].includes(key)) {
			// redraw the latest cloud with the new settings (an older trail would not match it)
			this.clear();
			if (this.lastCloudMsg)
				this.onMessage(this.lastCloudMsg);
		}
		if (key === "topic") {
			this.clear();
			this.lastCloudMsg = null;
			this.setInfo({});
		}
	}

	onFixedFrameChange() {
		this.clear(); // the kept poses were relative to the old fixed frame
	}

	onCameraChange() {
		this.applySize();
	}

	onDestroy() {
		clearInterval(this.decayTimer);
		this.clear();
		this.material.dispose();
		if (this.circle)
			this.circle.dispose();
	}
}
