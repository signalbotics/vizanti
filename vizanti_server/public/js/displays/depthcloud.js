import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { depthToPoints } from '../geometry/depth.js';

// A depth camera's image turned into a point cloud, using the intrinsics from CameraInfo.
export class DepthCloudDisplay extends Display {

	static type = "depthcloud";
	static label = "Depth Cloud";
	static icon = "assets/pointcloud.svg";
	static description = "A depth image (16UC1 or 32FC1) shown as points, using CameraInfo";
	static msgTypes = ["sensor_msgs/msg/Image"];

	static properties = {
		topic: { type: "topic", label: "Depth image topic" },
		info_topic: { type: "string", label: "CameraInfo topic" },
		stride: { type: "int", label: "Pixel step", default: 2, min: 1, max: 32, help: "Every n-th pixel in each direction is shown; raise it for large images." },
		max_depth: { type: "float", label: "Max depth (m)", default: 10, min: 0.1, max: 1000, step: 0.1 },
		thickness: { type: "float", label: "Point size (m)", default: 0.01, min: 0.001, max: 0.5, step: 0.005 },
		color: { type: "color", label: "Colour", default: "#29b6f6" },
		opacity: { type: "float", label: "Alpha", default: 1.0, min: 0.05, max: 1, step: 0.05, slider: true },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 200, min: 0, max: 10000 },
	};

	static propsForTopic(topic, type) {
		const base = topic.replace(/\/compressedDepth$/, "").replace(/\/[^/]*$/, "");
		return { ...super.propsForTopic(topic, type), info_topic: `${base}/camera_info` };
	}

	onCreate() {
		this.material = new THREE.PointsMaterial({ color: this.props.color, opacity: this.props.opacity, transparent: true, depthWrite: false });
		this.points = new THREE.Points(new THREE.BufferGeometry(), this.material);
		this.points.frustumCulled = false;
		this.points.visible = false;
		this.add(this.points);
		this.cameraInfo = null;
		this.applySize();
		this.subscribeInfo();
	}

	subscribeInfo() {
		if (this.infoUnsub) {
			this.infoUnsub();
			this.infoUnsub = null;
		}
		if (this.enabled && this.props.info_topic)
			this.infoUnsub = this.ctx.subscribe(this.props.info_topic, "sensor_msgs/msg/CameraInfo", 1000, (info) => { this.cameraInfo = info; });
	}

	applySize() {
		const size = this.ctx.scene.pointSize(this.props.thickness);
		this.material.size = size.size;
		if (this.material.sizeAttenuation !== size.sizeAttenuation) {
			this.material.sizeAttenuation = size.sizeAttenuation;
			this.material.needsUpdate = true;
		}
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header))
			return;
		const cloud = depthToPoints(msg, this.cameraInfo, { stride: this.props.stride, maxDepth: this.props.max_depth });
		if (cloud.error) {
			this.status.warn(cloud.error);
			return;
		}
		this.points.geometry.dispose();
		this.points.geometry = new THREE.BufferGeometry();
		this.points.geometry.setAttribute("position", new THREE.BufferAttribute(cloud.positions, 3));
		this.points.visible = cloud.count > 0;
		this.setInfo({ "Frame": msg.header.frame_id, "Size": `${msg.width} x ${msg.height}`, "Points": cloud.count });
	}

	_setEnabled(enabled) {
		super._setEnabled(enabled);
		this.subscribeInfo();
	}

	onCameraChange() {
		this.applySize();
	}

	onPropertyChange(key, value) {
		if (key === "color")
			this.material.color.set(value);
		if (key === "opacity")
			this.material.opacity = value;
		if (key === "thickness")
			this.applySize();
		if (key === "info_topic") {
			this.cameraInfo = null;
			this.subscribeInfo();
		}
		if (key === "topic") {
			this.points.visible = false;
			this.setInfo({});
		}
	}

	onDestroy() {
		if (this.infoUnsub)
			this.infoUnsub();
		this.points.geometry.dispose();
		this.material.dispose();
	}
}
