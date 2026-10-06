import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { scanPoints, radToDeg } from '../geometry/scan.js';
import { colorizeValues } from '../geometry/pointcloud.js';
import { Trail } from '../core/trail.js';

function rangeOf(values) {
	let min = Infinity, max = -Infinity;
	for (const v of values) {
		if (!Number.isFinite(v))
			continue;
		if (v < min) min = v;
		if (v > max) max = v;
	}
	return min <= max ? { min, max } : { min: 0, max: 0 };
}

export class ScanDisplay extends Display {

	static type = "scan";
	static label = "Laser Scan";
	static icon = "assets/scan.svg";
	static description = "Renders lidar scan points based on sensor_msgs/LaserScan data.";
	static msgTypes = ["sensor_msgs/msg/LaserScan"];

	// more rays than this are thinned, with a warning
	static budget = 20000;

	static properties = {
		topic: { type: "topic", label: "Topic" },
		opacity: { type: "float", label: "Opacity", default: 1.0, min: 0, max: 1, step: 0.05, slider: true },
		thickness: { type: "float", label: "Thickness (m)", default: 0.02, min: 0.01, max: 0.5, step: 0.01, slider: true },
		color: { type: "color", label: "Colour", default: "#ff0000" },
		colour_mode: {
			type: "enum", label: "Colour by", default: "flat",
			options: [
				{ value: "flat", label: "Flat colour" },
				{ value: "intensity", label: "Intensity" },
				{ value: "range", label: "Range (distance)" },
			],
			help: "Intensity and Range spread each scan's values over a blue (low) to red (high) rainbow.",
		},
		decay_ms: {
			type: "int", label: "Decay time (ms)", default: 0, min: 0, max: 60000, step: 100,
			help: "Keep each scan on screen this long, where it was measured. 0 shows only the latest scan.",
		},
		throttle: {
			type: "int", label: "Socket throttle (ms)", default: 2000, min: 0, max: 10000,
			help: "Laser scans are typically high bandwidth topics, and as such can easily cause TCP congestion. Lower the socket throttle rate to get faster data updates, but note that other visualizers may stutter.",
		},
	};

	onCreate() {
		this.material = new THREE.PointsMaterial({
			color: this.props.color,
			opacity: this.props.opacity,
			transparent: true,
			depthWrite: false,
		});
		this.trail = new Trail(this.root);
		this.hasData = false;
		this.lastScan = null;
		this.applySize();
		this.decayTimer = setInterval(() => this.expire(), 250);
	}

	expire() {
		if (this.props.decay_ms > 0 && this.trail.expire(this.props.decay_ms, performance.now()))
			this.requestRender();
	}

	applySize() {
		const size = this.ctx.scene.pointSize(this.props.thickness);
		this.material.size = size.size;
		if (this.material.sizeAttenuation !== size.sizeAttenuation) {
			this.material.sizeAttenuation = size.sizeAttenuation;
			this.material.needsUpdate = true; // switches shader variant
		}
	}

	applyVisibility() {
		this.root.visible = this.enabled && this.hasData && this.props.opacity > 0;
	}

	applyColour(useVertex) {
		if (this.material.vertexColors !== useVertex) {
			this.material.vertexColors = useVertex;
			this.material.needsUpdate = true;
		}
		this.material.color.set(useVertex ? "#ffffff" : this.props.color);
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header)) {
			this.hasData = false;
			this.applyVisibility();
			return;
		}

		const result = scanPoints(msg, ScanDisplay.budget);
		this.lastScan = msg;

		let values = null;
		if (this.props.colour_mode === "intensity") {
			if (result.intensities)
				values = result.intensities;
			else
				this.status.warn("This scan has no intensities; drawn in the flat colour.");
		} else if (this.props.colour_mode === "range") {
			values = result.ranges;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
		if (values) {
			const { min, max } = rangeOf(values);
			geometry.setAttribute("color", new THREE.BufferAttribute(colorizeValues(values, min, max), 3));
		}
		this.applyColour(!!values);

		if (this.props.decay_ms <= 0)
			this.trail.clear();
		const points = new THREE.Points(geometry, this.material);
		points.frustumCulled = false;
		points.renderOrder = this.order;
		this.root.updateMatrix();
		this.trail.push(points, this.root.matrix, performance.now());
		this.expire();
		this.hasData = result.count > 0;
		this.applyVisibility();

		this.setInfo({
			"TF frame": msg.header.frame_id,
			"Angle": `${radToDeg(msg.angle_min)}° to ${radToDeg(msg.angle_max)}°`,
			"Angle increment": `${radToDeg(msg.angle_increment)}°`,
			"Points": msg.ranges.length,
			"Scan time": `${Number(msg.scan_time).toFixed(5)} s`,
			"Min": `${Number(msg.range_min).toFixed(2)} m`,
			"Max": `${Number(msg.range_max).toFixed(2)} m`,
		});

		if (result.stride > 1)
			this.status.warn(`Showing every ${result.stride}th point: ${msg.ranges.length} points is over the ${ScanDisplay.budget} limit.`);
	}

	onPropertyChange(key, value) {
		if (key === "color")
			this.applyColour(this.material.vertexColors);
		if ((key === "colour_mode" || key === "decay_ms") && this.lastScan) {
			// redraw the latest scan with the new setting (an older trail would not match it)
			this.trail.clear();
			this.onMessage(this.lastScan);
		}
		if (key === "opacity")
			this.material.opacity = value;
		if (key === "thickness")
			this.applySize();
		if (key === "topic") {
			this.hasData = false;
			this.lastScan = null;
			this.trail.clear();
			this.setInfo({});
		}
		this.applyVisibility();
	}

	onCameraChange() {
		this.applySize(); // in the top-down view the point size is in pixels, so it follows the zoom
	}

	onFixedFrameChange() {
		this.trail.clear(); // the kept poses were relative to the old fixed frame
	}

	onDestroy() {
		clearInterval(this.decayTimer);
		this.trail.clear();
		this.material.dispose();
	}
}
