import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';

export class PointStampedDisplay extends Display {

	static type = "pointstamped";
	static label = "Point";
	static icon = "assets/marker.svg";
	static description = "geometry_msgs/PointStamped, such as a clicked point";
	static msgTypes = ["geometry_msgs/msg/PointStamped"];

	static properties = {
		topic: { type: "topic", label: "Topic" },
		color: { type: "color", label: "Colour", default: "#cc29cc" },
		radius: { type: "float", label: "Radius (m)", default: 0.2, min: 0.005, max: 10, step: 0.005 },
		history: { type: "int", label: "History length", default: 1, min: 1, max: 1000 },
		opacity: { type: "float", label: "Alpha", default: 1.0, min: 0.05, max: 1, step: 0.05, slider: true },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 100, min: 0, max: 10000 },
	};

	onCreate() {
		this.geometry = new THREE.SphereGeometry(1, 20, 12);
		this.material = new THREE.MeshLambertMaterial({ color: this.props.color, opacity: this.props.opacity, transparent: this.props.opacity < 1 });
		this.spheres = [];
	}

	onMessage(msg) {
		const p = this.toFixed(msg.header, msg.point);
		if (!p)
			return;
		const sphere = new THREE.Mesh(this.geometry, this.material);
		sphere.position.set(p.x, p.y, p.z);
		sphere.scale.setScalar(this.props.radius);
		this.add(sphere);
		this.spheres.push(sphere);
		this.trim();
		this.setInfo({
			"Frame": msg.header.frame_id,
			"X": msg.point.x.toFixed(3) + " m",
			"Y": msg.point.y.toFixed(3) + " m",
			"Z": msg.point.z.toFixed(3) + " m",
		});
	}

	trim() {
		while (this.spheres.length > this.props.history)
			this.spheres.shift().removeFromParent();
	}

	clear() {
		for (const sphere of this.spheres)
			sphere.removeFromParent();
		this.spheres = [];
	}

	onPropertyChange(key, value) {
		if (key === "color")
			this.material.color.set(value);
		if (key === "opacity") {
			this.material.opacity = value;
			this.material.transparent = value < 1;
			this.material.needsUpdate = true;
		}
		if (key === "radius") {
			for (const sphere of this.spheres)
				sphere.scale.setScalar(value);
		}
		if (key === "history")
			this.trim();
		if (key === "topic") {
			this.clear();
			this.setInfo({});
		}
	}

	// the points were placed in the old fixed frame
	onFixedFrameChange() {
		this.clear();
	}

	onDestroy() {
		this.geometry.dispose();
		this.material.dispose();
	}
}
