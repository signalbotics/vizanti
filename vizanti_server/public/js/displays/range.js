import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { FlatMesh } from '../core/flat_mesh.js';
import { rangeSector } from '../geometry/shapes.js';

const RADIATION_TYPE = { 0: "Ultrasound", 1: "Infrared" };

export class RangeDisplay extends Display {

	static type = "range";
	static label = "Range";
	static icon = "assets/range.svg";
	static description = "sensor_msgs/Range";
	static msgTypes = ["sensor_msgs/msg/Range"];

	static properties = {
		topic: { type: "topic", label: "Topic" },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 100, min: 0, max: 10000 },
		decay: { type: "int", label: "Decay time (ms)", default: 2000, min: -1, max: 60000 },
		opacity: { type: "float", label: "Opacity", default: 0.9, min: 0.1, max: 1, step: 0.05, slider: true },
	};

	get iconColor() {
		return null;
	}

	onCreate() {
		// several sensors can share one topic; each gets its own cone, keyed by frame
		this.sensors = new Map();
		this.timer = setInterval(() => this.expire(), 250);
	}

	sensor(frame) {
		let entry = this.sensors.get(frame);
		if (!entry) {
			entry = {
				group: new THREE.Group(),
				cone: new FlatMesh("#33414e", 0.59 * this.props.opacity),
				hit: new FlatMesh("#5eb4ff", this.props.opacity),
				stamp: 0,
			};
			entry.group.add(entry.cone.mesh, entry.hit.mesh);
			entry.group.traverse((object) => { object.renderOrder = this.order; });
			this.sensors.set(frame, entry);
		}
		return entry;
	}

	onMessage(msg) {
		let frame = msg.header.frame_id;
		if (frame === "") {
			this.status.warn("Transform frame is an empty string, falling back to fixed frame. Fix your publisher ;)");
			frame = this.ctx.tf.fixed_frame;
		}
		const node = this.ctx.frames.get(frame);
		if (!node) {
			this.status.error(`Required transform frame "${frame}" not found.`);
			return;
		}

		const entry = this.sensor(frame);
		if (entry.group.parent !== node)
			node.add(entry.group);

		// the measured distance is shown as a band at the far end of the reading
		const band = Math.max(0.01, 0.03 * msg.max_range);
		entry.cone.setTriangles(rangeSector(Math.max(0, msg.min_range), msg.max_range, msg.field_of_view));
		entry.hit.setTriangles(rangeSector(Math.max(0, msg.range - band), msg.range, msg.field_of_view));
		entry.stamp = Date.now();
		entry.group.visible = true;

		this.setInfo({
			"Range": Number(msg.range).toFixed(3) + " m",
			"Min": Number(msg.min_range).toFixed(3) + " m",
			"Max": Number(msg.max_range).toFixed(3) + " m",
			"Field of view": (msg.field_of_view * (180 / Math.PI)).toFixed(2) + "°",
			"Type": RADIATION_TYPE[msg.radiation_type] ?? "Unknown",
		});
	}

	// readings older than the decay time are hidden; a decay of zero or less keeps them
	expire() {
		if (this.props.decay <= 0)
			return;
		const now = Date.now();
		let changed = false;
		for (const entry of this.sensors.values()) {
			const visible = now - entry.stamp <= this.props.decay;
			if (entry.group.visible !== visible) {
				entry.group.visible = visible;
				changed = true;
			}
		}
		if (changed)
			this.requestRender();
	}

	clear() {
		for (const entry of this.sensors.values()) {
			entry.group.removeFromParent();
			entry.cone.dispose();
			entry.hit.dispose();
		}
		this.sensors.clear();
	}

	_setOrder(index) {
		super._setOrder(index);
		for (const entry of this.sensors.values())
			entry.group.traverse((object) => { object.renderOrder = index; });
	}

	_setEnabled(enabled) {
		super._setEnabled(enabled);
		if (!enabled)
			this.clear(); // the cones hang off TF frame nodes, outside this.root
	}

	onPropertyChange(key, value) {
		if (key === "opacity") {
			for (const entry of this.sensors.values()) {
				entry.cone.material.opacity = 0.59 * value;
				entry.hit.material.opacity = value;
			}
		}
		if (key === "topic") {
			this.clear();
			this.setInfo({});
		}
	}

	onDestroy() {
		clearInterval(this.timer);
		this.clear();
	}
}
