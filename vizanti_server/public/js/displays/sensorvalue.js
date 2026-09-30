import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { sensorReading, SENSOR_TYPES } from '../geometry/sensors.js';

// The reading of a temperature, pressure, light or humidity sensor, written at its frame.
export class SensorValueDisplay extends Display {

	static type = "sensorvalue";
	static label = "Sensor Value";
	static icon = "assets/temp_warm.svg";
	static description = "Temperature, FluidPressure, Illuminance or RelativeHumidity, written at the sensor's frame";
	static msgTypes = Object.values(SENSOR_TYPES);

	static properties = {
		topic: { type: "topic", label: "Topic" },
		topic_type: { type: "string", hidden: true },
		color: { type: "color", label: "Colour", default: "#ffffff" },
		size: { type: "int", label: "Font size (px)", default: 16, min: 6, max: 96 },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 200, min: 0, max: 10000 },
	};

	onCreate() {
		this.reading = null;
		this.anchor = new THREE.Object3D();
		this.add(this.anchor);
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header, { follow: true }))
			return;
		this.reading = sensorReading(msg, this.topicType);
		if (!this.reading) {
			this.status.warn("The message has no usable reading.");
			return;
		}
		this.setInfo({ "Frame": msg.header.frame_id, "Reading": this.reading.text });
	}

	onPropertyChange(key) {
		if (key === "topic") {
			this.reading = null;
			this.setInfo({});
		}
		this.requestRender();
	}

	onTfChange() {
		this.requestRender();
	}

	onOverlay(ctx, scene) {
		if (!this.reading || !this.root.parent)
			return;
		const position = this.anchor.getWorldPosition(new THREE.Vector3());
		const p = scene.project(position.x, position.y, position.z);
		if (!p.visible)
			return;
		ctx.font = `bold ${this.props.size}px Monospace`;
		ctx.textAlign = "center";
		ctx.lineWidth = 4;
		ctx.strokeStyle = "#161B21";
		ctx.fillStyle = this.props.color;
		ctx.strokeText(this.reading.text, p.x, p.y - 10);
		ctx.fillText(this.reading.text, p.x, p.y - 10);
	}
}
