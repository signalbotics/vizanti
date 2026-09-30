import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { decodeCloud } from '../geometry/pointcloud.js';

export class PointCloudDisplay extends Display {

	static type = "pointcloud";
	static label = "Point Cloud";
	static icon = "assets/pointcloud.svg";
	static description = "sensor_msgs/PointCloud2";
	static msgTypes = ["sensor_msgs/msg/PointCloud2"];

	static properties = {
		topic: { type: "topic", label: "Topic" },
		thickness: { type: "float", label: "Thickness (m)", default: 0.02, min: 0.01, max: 0.5, step: 0.01, slider: true },
		max_points: { type: "int", label: "Max Points", default: 15000, min: 100, max: 500000, step: 100 },
		opacity: { type: "float", label: "Opacity", default: 1.0, min: 0.1, max: 1, step: 0.05, slider: true },
		colours: {
			type: "group", label: "Colour Config", properties: {
				color: { type: "color", label: "Fallback Colour", default: "#1f8eec", help: "If the cloud contains no rgb data, the above colour will be used." },
				colour_override: { type: "bool", label: "Override RGB with flat colour", default: false },
			},
		},
		throttle: {
			type: "int", label: "Socket throttle (ms)", default: 1000, min: 0, max: 10000,
			help: "Point clouds are very high bandwidth topics, and as such can easily cause TCP congestion. Lower the socket throttle time to get faster data updates over high bandwidth connections.",
		},
	};

	onCreate() {
		this.material = new THREE.PointsMaterial({ color: this.props.color, opacity: this.props.opacity, transparent: true, depthWrite: false });
		this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
		this.points.frustumCulled = false;
		this.points.visible = false;
		this.add(this.points);
		this.hasColors = false;
		this.applySize();
	}

	applySize() {
		const size = this.ctx.scene.pointSize(this.props.thickness);
		this.material.size = size.size;
		if (this.material.sizeAttenuation !== size.sizeAttenuation) {
			this.material.sizeAttenuation = size.sizeAttenuation;
			this.material.needsUpdate = true;
		}
	}

	// per-point colours are used when the cloud has them and the flat colour is not forced
	applyColour() {
		const useVertex = this.hasColors && !this.props.colour_override;
		if (this.material.vertexColors !== useVertex) {
			this.material.vertexColors = useVertex;
			this.material.needsUpdate = true;
		}
		this.material.color.set(useVertex ? "#ffffff" : this.props.color);
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header)) {
			this.points.visible = false;
			return;
		}
		const cloud = decodeCloud(msg, this.props.max_points);
		if (cloud.error) {
			this.status.error(cloud.error);
			this.points.visible = false;
			return;
		}

		this.points.geometry.dispose();
		this.points.geometry = new THREE.BufferGeometry();
		this.points.geometry.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
		if (cloud.colors)
			this.points.geometry.setAttribute("color", new THREE.BufferAttribute(cloud.colors, 3));
		this.hasColors = !!cloud.colors;
		this.applyColour();
		this.points.visible = cloud.count > 0;

		this.setInfo({
			"Frame": msg.header.frame_id,
			"Points": msg.width * msg.height,
			"Shown": cloud.count,
			"Colour": cloud.colors ? "RGB" : "none",
		});
	}

	onPropertyChange(key, value) {
		if (key === "opacity")
			this.material.opacity = value;
		if (key === "thickness")
			this.applySize();
		if (key === "color" || key === "colour_override")
			this.applyColour();
		if (key === "topic") {
			this.points.visible = false;
			this.setInfo({});
		}
	}

	onCameraChange() {
		this.applySize();
	}

	onDestroy() {
		this.points.geometry.dispose();
		this.material.dispose();
	}
}
