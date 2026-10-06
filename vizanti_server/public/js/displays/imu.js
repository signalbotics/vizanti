import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { makeArrow, aimAlong, disposeObject } from '../core/arrow.js';
import { imuSummary } from '../geometry/imu.js';

// sensor_msgs/Imu at the IMU's frame: axes for its orientation (in the fixed frame, as an AHRS
// reports it) and an arrow for the linear acceleration (in the sensor frame).
export class ImuDisplay extends Display {

	static type = "imu";
	static label = "IMU";
	static icon = "assets/tf.svg";
	static description = "sensor_msgs/Imu: orientation axes and an acceleration arrow at the IMU frame";
	static msgTypes = ["sensor_msgs/msg/Imu"];

	static properties = {
		topic: { type: "topic", label: "Topic" },
		show_orientation: { type: "bool", label: "Show orientation", default: true },
		axes_length: { type: "float", label: "Axes length (m)", default: 0.3, min: 0.01, max: 10, step: 0.01 },
		show_acceleration: { type: "bool", label: "Show acceleration", default: true },
		accel_scale: {
			type: "float", label: "Acceleration scale (m per m/s²)", default: 0.05, min: 0.001, max: 1, step: 0.005,
			help: "At the default 0.05, gravity (9.81 m/s²) is drawn about half a metre long.",
		},
		accel_color: { type: "color", label: "Acceleration colour", default: "#ffd23f" },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 100, min: 0, max: 10000 },
	};

	onCreate() {
		this.orientation = new THREE.Group();
		this.add(this.orientation);
		this.accelMaterial = new THREE.MeshLambertMaterial({ color: this.props.accel_color });
		this.accel = new THREE.Group();
		this.add(this.accel);
		this.buildAxes();
		this.root.visible = false;
	}

	buildAxes() {
		disposeObject(this.orientation);
		this.orientation.clear();
		const length = this.props.axes_length, radius = length * 0.04;
		for (const [color, x, y, z] of [["#e0000b", 1, 0, 0], ["#29ff26", 0, 1, 0], ["#0084ff", 0, 0, 1]]) {
			const arrow = makeArrow(length, radius, radius * 2, length * 0.25, new THREE.MeshLambertMaterial({ color }));
			aimAlong(arrow, x, y, z);
			arrow.traverse((object) => { object.renderOrder = this.order; });
			this.orientation.add(arrow);
		}
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header)) {
			this.root.visible = false;
			return;
		}
		this.root.visible = this.enabled;
		const summary = imuSummary(msg);

		// the reported orientation is in the fixed frame: undo the IMU frame's own rotation
		this.orientation.visible = this.props.show_orientation && summary.hasOrientation;
		if (summary.hasOrientation) {
			const q = msg.orientation;
			const reported = new THREE.Quaternion(q.x, q.y, q.z, q.w).normalize();
			this.orientation.quaternion.copy(this.root.quaternion.clone().invert().multiply(reported));
		}

		disposeObject(this.accel);
		this.accel.clear();
		const a = msg.linear_acceleration;
		const length = summary.accelNorm * this.props.accel_scale;
		this.accel.visible = this.props.show_acceleration && length > 1e-6;
		if (this.accel.visible) {
			const radius = Math.max(0.005, length * 0.03);
			const arrow = makeArrow(length, radius, radius * 2.2, Math.min(length * 0.3, radius * 8), this.accelMaterial.clone());
			aimAlong(arrow, a.x, a.y, a.z);
			arrow.traverse((object) => { object.renderOrder = this.order; });
			this.accel.add(arrow);
		}

		const f = (v) => v.toFixed(1);
		this.setInfo({
			"Frame": msg.header.frame_id,
			"Roll / pitch / yaw": summary.rpyDeg ? summary.rpyDeg.map(f).join("° / ") + "°" : "not provided",
			"Acceleration": `${summary.accelNorm.toFixed(2)} m/s²`,
			"Angular velocity": `${summary.gyroNorm.toFixed(2)} rad/s`,
		});
		this.requestRender();
	}

	onPropertyChange(key, value) {
		if (key === "axes_length")
			this.buildAxes();
		if (key === "accel_color")
			this.accelMaterial.color.set(value);
		if (key === "show_orientation" || key === "show_acceleration" || key === "accel_scale" || key === "accel_color") {
			if (this.lastMsg)
				this.onMessage(this.lastMsg);
		}
		if (key === "topic") {
			this.root.visible = false;
			this.setInfo({});
		}
	}

	onDestroy() {
		disposeObject(this.orientation);
		disposeObject(this.accel);
		this.accelMaterial.dispose();
	}
}
