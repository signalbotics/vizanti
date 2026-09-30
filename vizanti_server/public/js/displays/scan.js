import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { scanPoints, radToDeg } from '../geometry/scan.js';

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
		this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
		this.points.frustumCulled = false;
		this.points.visible = false;
		this.add(this.points);
		this.hasData = false;
		this.applySize();
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
		this.points.visible = this.hasData && this.props.opacity > 0;
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header)) {
			this.hasData = false;
			this.applyVisibility();
			return;
		}

		const result = scanPoints(msg, ScanDisplay.budget);

		this.points.geometry.dispose();
		this.points.geometry = new THREE.BufferGeometry();
		this.points.geometry.setAttribute("position", new THREE.BufferAttribute(result.positions, 3));
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
			this.material.color.set(value);
		if (key === "opacity")
			this.material.opacity = value;
		if (key === "thickness")
			this.applySize();
		if (key === "topic") {
			this.hasData = false;
			this.setInfo({});
		}
		this.applyVisibility();
	}

	onCameraChange() {
		this.applySize(); // in the top-down view the point size is in pixels, so it follows the zoom
	}

	onDestroy() {
		this.points.geometry.dispose();
		this.material.dispose();
	}
}
