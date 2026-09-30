import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { mapToRGBA } from '../geometry/map.js';

const ICONS = {
	map: "assets/map.svg",
	costmap: "assets/costmap.svg",
	raw: "assets/rawmap.svg",
	raw_transparent: "assets/rawmap_transparent_white.svg",
	raw_transparent_black: "assets/rawmap_transparent_black.svg",
	sonar: "assets/sonar.svg",
};

export class MapDisplay extends Display {

	static type = "map";
	static label = "Map";
	static icon = "assets/map.svg";
	static drawLayer = -1;
	static description = "Display a nav_msgs/OccupancyGrid message that typically represents a 2D map or navigational costmap.";
	static msgTypes = ["nav_msgs/msg/OccupancyGrid"];

	static properties = {
		topic: { type: "topic", label: "Topic" },
		colour_scheme: {
			type: "enum", label: "Colour scheme", default: "map",
			options: [
				{ value: "map", label: "Map" },
				{ value: "costmap", label: "Costmap" },
				{ value: "raw", label: "Raw" },
				{ value: "raw_transparent", label: "Raw + White Transparency" },
				{ value: "raw_transparent_black", label: "Raw + Black Transparency" },
				{ value: "sonar", label: "Sonar (Raw as False-colour HDR)" },
			],
		},
		use_timestamp: {
			type: "bool", label: "Use Timestamp", default: false,
			help: "Rendering maps at their published timestamp causes them to lag behind when focusing on frames other than the map frame. Rviz uses the latest timestamp instead, which this emulates. Enable for technically correct rendering.",
		},
		opacity: { type: "float", label: "Opacity", default: 0.7, min: 0, max: 1, step: 0.05, slider: true },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 1000, min: 0, max: 10000 },
	};

	// the old widget stored the colour scheme as the index of its dropdown
	static fromLegacy(state) {
		const schemes = ["map", "costmap", "raw", "raw_transparent", "raw_transparent_black", "sonar"];
		let scheme = "map";
		if (state.costmap_mode !== undefined)
			scheme = state.costmap_mode ? "costmap" : "map";
		else if (Number.isInteger(state.colour_scheme) && schemes[state.colour_scheme])
			scheme = schemes[state.colour_scheme];
		else if (schemes.includes(state.colour_scheme))
			scheme = state.colour_scheme;
		return { ...state, colour_scheme: scheme };
	}

	static propsForTopic(topic) {
		return { topic, colour_scheme: topic.includes("cost") ? "costmap" : "map" };
	}

	get icon() {
		return ICONS[this.props.colour_scheme] ?? MapDisplay.icon;
	}

	onCreate() {
		this.material = new THREE.MeshBasicMaterial({
			transparent: true,
			opacity: this.props.opacity,
			depthWrite: false,
			side: THREE.DoubleSide,
			// a ground layer: scans, TF and markers at the same height stay on top of it
			polygonOffset: true,
			polygonOffsetFactor: 1,
			polygonOffsetUnits: 1,
		});
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
		this.mesh.visible = false;
		this.add(this.mesh);

		this.texture = null;
		this.hasData = false;
		this.seq = 0;
		this.jobs = new Map(); // seq -> message, for conversions still in the worker

		this.worker = null;
		try {
			this.worker = new Worker(new URL("../workers/map_worker.js", import.meta.url), { type: "module" });
			this.worker.onmessage = (event) => {
				const msg = this.jobs.get(event.data.seq);
				this.jobs.delete(event.data.seq);
				if (msg)
					this.apply(event.data, msg);
			};
			this.worker.onerror = () => {
				// no module worker support: convert on the main thread from now on
				this.worker.terminate();
				this.worker = null;
				this.jobs.clear();
				if (this.lastMsg)
					this.convert(this.lastMsg);
			};
		} catch (e) {
			this.worker = null;
		}
	}

	applyVisibility() {
		this.mesh.visible = this.hasData && this.props.opacity > 0;
	}

	onMessage(msg) {
		if (msg.info.width === 0 || msg.info.height === 0) {
			this.status.warn("Received empty map.");
			return;
		}

		// A map often arrives before its TF. Draw it at identity so an initial pose can be
		// given relative to it; this matches the current widget.
		const tf = this.ctx.tf;
		if (msg.header.frame_id === "map" && !tf.absoluteTransforms["map"]) {
			tf.absoluteTransforms["map"] = { translation: { x: 0, y: 0, z: 0 }, rotation: new Quaternion() };
			tf.frame_list.add("map");
			this.status.warn("Map transform not available yet, using identity transform.");
		}

		if (!this.setFrame(msg.header, { follow: !this.props.use_timestamp })) {
			this.hasData = false;
			this.applyVisibility();
			return;
		}
		// the verdict comes from apply(), once the conversion is back from the worker
		this.status.touched = true;
		this.convert(msg);
	}

	convert(msg) {
		const seq = ++this.seq;
		const request = {
			seq,
			data: msg.data,
			width: msg.info.width,
			height: msg.info.height,
			scheme: this.props.colour_scheme,
			maxSize: this.ctx.scene.renderer.capabilities.maxTextureSize,
		};

		if (this.worker) {
			this.jobs.set(seq, msg);
			this.worker.postMessage(request);
		} else {
			this.apply({ seq, ...mapToRGBA(request.data, request.width, request.height, request.scheme, request.maxSize) }, msg);
		}
	}

	apply(result, msg) {
		if (!this._alive || result.seq !== this.seq)
			return; // a newer map is already being converted

		if (result.error) {
			this.status.error(result.error);
			this.hasData = false;
			this.applyVisibility();
			this.requestRender();
			return;
		}

		if (this.texture)
			this.texture.dispose();
		this.texture = new THREE.DataTexture(result.rgba, result.width, result.height, THREE.RGBAFormat);
		this.texture.magFilter = THREE.NearestFilter;
		this.texture.minFilter = THREE.NearestFilter;
		this.texture.colorSpace = THREE.SRGBColorSpace;
		this.texture.needsUpdate = true;
		this.material.map = this.texture;
		this.material.needsUpdate = true;

		// cell (0,0) is at the map origin, so the plane's corner, not its centre, goes there
		const w = msg.info.width * msg.info.resolution;
		const h = msg.info.height * msg.info.resolution;
		this.mesh.geometry.dispose();
		this.mesh.geometry = new THREE.PlaneGeometry(w, h).translate(w / 2, h / 2, 0);

		const origin = msg.info.origin;
		this.mesh.position.set(origin.position.x, origin.position.y, origin.position.z);
		const q = origin.orientation;
		if (q.x === 0 && q.y === 0 && q.z === 0 && q.w === 0)
			this.mesh.quaternion.set(0, 0, 0, 1); // an all-zero quaternion is a publisher mistake
		else
			this.mesh.quaternion.set(q.x, q.y, q.z, q.w);

		this.hasData = true;
		this.applyVisibility();

		if (result.factor > 1)
			this.status.warn(`Map is ${msg.info.width}x${msg.info.height}, larger than this device can draw; showing every ${result.factor}th cell.`);
		else if (this.status.text !== "Map transform not available yet, using identity transform.")
			this.status.ok();

		this.requestRender();
	}

	onPropertyChange(key, value) {
		if (key === "opacity")
			this.material.opacity = value;
		if (key === "colour_scheme" && this.lastMsg)
			this.convert(this.lastMsg);
		if (key === "use_timestamp" && this.lastMsg)
			this.setFrame(this.lastMsg.header, { follow: !value });
		if (key === "topic") {
			this.hasData = false;
			this.seq++; // a conversion still running belongs to the old topic
			this.jobs.clear();
		}
		this.applyVisibility();
	}

	onContextRestored() {
		if (this.texture)
			this.texture.needsUpdate = true;
	}

	onDestroy() {
		if (this.worker)
			this.worker.terminate();
		if (this.texture)
			this.texture.dispose();
		this.mesh.geometry.dispose();
		this.material.dispose();
	}
}
