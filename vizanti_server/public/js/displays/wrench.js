import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { makeArrow, aimAlong, disposeObject } from '../core/arrow.js';
import { vectorPair, VECTOR_TYPES } from '../geometry/vectors.js';

const UNITS = {
	[VECTOR_TYPES[0]]: ["Force", "N", "Torque", "Nm"],
	[VECTOR_TYPES[1]]: ["Linear", "m/s", "Angular", "rad/s"],
	[VECTOR_TYPES[2]]: ["Linear", "m/s²", "Angular", "rad/s²"],
};

// Two arrows at a frame: the linear part and the angular part of a wrench, twist or acceleration.
export class WrenchDisplay extends Display {

	static type = "wrench";
	static label = "Wrench / Twist / Accel";
	static icon = "assets/pose.svg";
	static description = "geometry_msgs/WrenchStamped, TwistStamped or AccelStamped as two arrows";
	static msgTypes = VECTOR_TYPES;

	static properties = {
		topic: { type: "topic", label: "Topic" },
		topic_type: { type: "string", hidden: true },
		linear_color: { type: "color", label: "Force / linear colour", default: "#cc3333" },
		angular_color: { type: "color", label: "Torque / angular colour", default: "#cccc33" },
		linear_scale: { type: "float", label: "Force / linear scale (m per unit)", default: 1.0, min: 0.0001, max: 1000, step: 0.01 },
		angular_scale: { type: "float", label: "Torque / angular scale (m per unit)", default: 1.0, min: 0.0001, max: 1000, step: 0.01 },
		width: { type: "float", label: "Arrow width (m)", default: 0.05, min: 0.001, max: 5, step: 0.005 },
		opacity: { type: "float", label: "Alpha", default: 1.0, min: 0.05, max: 1, step: 0.05, slider: true },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 100, min: 0, max: 10000 },
	};

	get iconColor() {
		return this.props.linear_color;
	}

	onCreate() {
		const material = (color) => new THREE.MeshLambertMaterial({ color, opacity: this.props.opacity, transparent: this.props.opacity < 1 });
		this.linearMaterial = material(this.props.linear_color);
		this.angularMaterial = material(this.props.angular_color);
		this.arrows = new THREE.Group();
		this.add(this.arrows);
		this.pair = null;
	}

	rebuild() {
		for (const child of [...this.arrows.children]) {
			child.removeFromParent();
			child.traverse((object) => { if (object.geometry) object.geometry.dispose(); });
		}
		if (!this.pair)
			return;
		const width = this.props.width;
		const add = (vector, scale, material) => {
			const length = Math.hypot(vector.x, vector.y, vector.z) * scale;
			if (!(length > 0))
				return;
			const arrow = makeArrow(length, width / 2, width, Math.min(width * 3, length * 0.4), material);
			aimAlong(arrow, vector.x, vector.y, vector.z);
			arrow.traverse((object) => { object.renderOrder = this.order; });
			this.arrows.add(arrow);
		};
		add(this.pair.linear, this.props.linear_scale, this.linearMaterial);
		add(this.pair.angular, this.props.angular_scale, this.angularMaterial);
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header, { follow: true })) {
			this.pair = null;
			this.rebuild();
			return;
		}
		this.pair = vectorPair(msg, this.topicType);
		if (!this.pair) {
			this.status.warn("The message has no usable vectors.");
			this.rebuild();
			return;
		}
		this.rebuild();
		const [a, au, b, bu] = UNITS[this.topicType];
		const mag = (v) => Math.hypot(v.x, v.y, v.z).toFixed(3);
		this.setInfo({ "Frame": msg.header.frame_id, [a]: `${mag(this.pair.linear)} ${au}`, [b]: `${mag(this.pair.angular)} ${bu}` });
	}

	onPropertyChange(key, value) {
		if (key === "linear_color")
			this.linearMaterial.color.set(value);
		if (key === "angular_color")
			this.angularMaterial.color.set(value);
		if (key === "opacity") {
			for (const material of [this.linearMaterial, this.angularMaterial]) {
				material.opacity = value;
				material.transparent = value < 1;
				material.needsUpdate = true;
			}
		}
		if (key === "topic") {
			this.pair = null;
			this.setInfo({});
		}
		this.rebuild();
	}

	onDestroy() {
		disposeObject(this.arrows);
		this.linearMaterial.dispose();
		this.angularMaterial.dispose();
	}
}
