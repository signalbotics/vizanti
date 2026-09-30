import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { imageToRGBA } from '../geometry/image.js';
import { toBytes } from '../geometry/pointcloud.js';
import { frustumCorners, cameraInfoValid } from '../geometry/camera.js';

const RAW = "sensor_msgs/msg/Image";
const COMPRESSED = "sensor_msgs/msg/CompressedImage";

// A camera image shown where the camera is: on the image plane of its frustum, from the
// intrinsics in CameraInfo. The frustum outline and a corner overlay are optional.
export class CameraDisplay extends Display {

	static type = "camera";
	static label = "Camera";
	static icon = "assets/image.svg";
	static description = "A camera image placed on its frustum in 3D, using CameraInfo";
	static msgTypes = [RAW, COMPRESSED];

	static properties = {
		topic: { type: "topic", label: "Image topic" },
		topic_type: { type: "string", hidden: true },
		info_topic: { type: "string", label: "CameraInfo topic", help: "Usually camera_info next to the image topic." },
		distance: { type: "float", label: "Image distance (m)", default: 1.0, min: 0.01, max: 100, step: 0.05 },
		opacity: { type: "float", label: "Alpha", default: 0.8, min: 0.05, max: 1, step: 0.05, slider: true },
		show_frustum: { type: "bool", label: "Frustum outline", default: true },
		show_overlay: { type: "bool", label: "Also show in a corner", default: false },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 200, min: 0, max: 10000 },
	};

	// ".../image_raw" or ".../image_raw/compressed" -> ".../camera_info"
	static propsForTopic(topic, type) {
		const base = topic.replace(/\/compressed$/, "").replace(/\/[^/]*$/, "");
		return { ...super.propsForTopic(topic, type), info_topic: `${base}/camera_info` };
	}

	get iconColor() {
		return null;
	}

	onCreate() {
		this.canvas = document.createElement("canvas");
		this.canvas.className = "image_display";
		this.canvas.style.display = "none";
		this.canvas.style.top = "8px";
		this.canvas.style.right = "8px";
		this.canvas.style.left = "auto";
		this.canvas.style.width = "320px";
		this.ctx.scene.container.appendChild(this.canvas);

		this.texture = new THREE.CanvasTexture(this.canvas);
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.material = new THREE.MeshBasicMaterial({
			map: this.texture, transparent: true, opacity: this.props.opacity, depthWrite: false, side: THREE.DoubleSide,
		});
		this.plane = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
		this.plane.visible = false;
		this.frustum = this.ctx.scene.makeLines({ color: "#ffffff", linewidth: 1, opacity: 0.7 });
		this.add(this.plane);
		this.add(this.frustum);

		this.cameraInfo = null;
		this.hasImage = false;
		this.decoding = false;
		this.subscribeInfo();
	}

	subscribeInfo() {
		if (this.infoUnsub) {
			this.infoUnsub();
			this.infoUnsub = null;
		}
		if (!this.enabled || !this.props.info_topic)
			return;
		this.infoUnsub = this.ctx.subscribe(this.props.info_topic, "sensor_msgs/msg/CameraInfo", 1000, (info) => {
			if (!this._alive)
				return;
			const k = info.k ?? info.K ?? [];
			const old = this.cameraInfo?.k ?? this.cameraInfo?.K ?? [];
			const changed = !this.cameraInfo || info.width !== this.cameraInfo.width || info.height !== this.cameraInfo.height
				|| Array.from(k).some((v, i) => v !== old[i]);
			this.cameraInfo = info;
			if (changed)
				this.shape();
		});
	}

	// the image plane and frustum outline, from CameraInfo or, without it, a 60 degree guess
	shape() {
		const d = this.props.distance;
		let c;
		if (cameraInfoValid(this.cameraInfo)) {
			c = frustumCorners(this.cameraInfo, d);
		} else {
			const w = this.canvas.width || 4, h = this.canvas.height || 3;
			const half = Math.tan(Math.PI / 6) * d;
			const x = half, y = half * h / w;
			c = { topLeft: { x: -x, y: -y, z: d }, topRight: { x, y: -y, z: d }, bottomLeft: { x: -x, y, z: d }, bottomRight: { x, y, z: d } };
		}
		const { topLeft: a, topRight: b, bottomLeft: e, bottomRight: f } = c;

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([a.x, a.y, a.z, b.x, b.y, b.z, e.x, e.y, e.z, f.x, f.y, f.z]), 3));
		geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 0, 0, 1, 0]), 2));
		geometry.setIndex([0, 2, 1, 1, 2, 3]);
		this.plane.geometry.dispose();
		this.plane.geometry = geometry;

		const lines = [];
		for (const p of [a, b, e, f])
			lines.push(0, 0, 0, p.x, p.y, p.z);
		for (const [p, q] of [[a, b], [b, f], [f, e], [e, a]])
			lines.push(p.x, p.y, p.z, q.x, q.y, q.z);
		this.ctx.scene.setLinePositions(this.frustum, new Float32Array(lines));
		this.applyVisibility();
		this.requestRender();
	}

	applyVisibility() {
		this.plane.visible = this.hasImage;
		this.frustum.visible = this.props.show_frustum && (this.hasImage || !!this.cameraInfo);
		this.canvas.style.display = this.enabled && this.hasImage && this.props.show_overlay ? "block" : "none";
	}

	async onMessage(msg) {
		if (!this.setFrame(msg.header, { follow: true }))
			return;
		if (this.decoding)
			return; // still drawing the previous frame; skip this one
		this.decoding = true;
		try {
			const sizeBefore = [this.canvas.width, this.canvas.height];
			if (this.topicType === COMPRESSED) {
				const bytes = toBytes(msg.data);
				if (!bytes)
					throw new Error("Image data arrived in an unknown form.");
				const bitmap = await createImageBitmap(new Blob([bytes], { type: msg.format?.includes("png") ? "image/png" : "image/jpeg" }));
				this.canvas.width = bitmap.width;
				this.canvas.height = bitmap.height;
				this.canvas.getContext("2d").drawImage(bitmap, 0, 0);
				bitmap.close();
			} else {
				const image = imageToRGBA(msg);
				if (image.error)
					throw new Error(image.error);
				this.canvas.width = image.width;
				this.canvas.height = image.height;
				this.canvas.getContext("2d").putImageData(new ImageData(image.rgba, image.width, image.height), 0, 0);
			}
			if (!this._alive)
				return;
			this.texture.dispose(); // the canvas may have changed size
			this.texture.needsUpdate = true;
			this.hasImage = true;
			if (!this.cameraInfo || sizeBefore[0] !== this.canvas.width || sizeBefore[1] !== this.canvas.height)
				this.shape();
			this.applyVisibility();
			if (!cameraInfoValid(this.cameraInfo))
				this.status.warn(`No usable CameraInfo on "${this.props.info_topic}"; the image is placed with a guessed field of view.`);
			else
				this.status.ok();
			this.setInfo({ "Frame": msg.header.frame_id, "Size": `${this.canvas.width} x ${this.canvas.height}` });
			this.requestRender();
		} catch (e) {
			this.status.error(e.message);
		} finally {
			this.decoding = false;
		}
	}

	_setEnabled(enabled) {
		super._setEnabled(enabled);
		this.subscribeInfo();
		this.applyVisibility();
	}

	onPropertyChange(key, value) {
		if (key === "opacity")
			this.material.opacity = value;
		if (key === "info_topic") {
			this.cameraInfo = null;
			this.subscribeInfo();
		}
		if (key === "topic") {
			this.hasImage = false;
			this.setInfo({});
		}
		if (key === "distance" || key === "info_topic")
			this.shape();
		this.applyVisibility();
	}

	onDestroy() {
		if (this.infoUnsub)
			this.infoUnsub();
		this.canvas.remove();
		this.texture.dispose();
		this.material.dispose();
		this.plane.geometry.dispose();
		this.ctx.scene.disposeLines(this.frustum);
	}
}
