import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

export const SPEED_UNITS = {
	"m/s": 1,
	"km/h": 3.6,
	"kts": 1.943844,
	"mph": 2.236936,
	"ft/s": 3.28084,
	"b/s": 6.56167, // bananas per second
};

const SAMPLE_SIZE = 10; // samples averaged
const SMOOTHING = 0.5; // low-pass weight of the newest sample
const NEEDLE_SWEEP_DEG = 195;
const ICON_REFRESH_MS = 200;

// fits the gauge's small window: at most four digits before the point
export function formatDial(value) {
	if (value >= 10000)
		return "9999";
	if (value >= 1000)
		return Math.floor(value).toString();
	if (value >= 10)
		return value.toFixed(2);
	return value.toFixed(3);
}

// Speed from successive positions and stamps: low-pass filtered, averaged, with min / max.
export class SpeedTracker {

	constructor() {
		this.reset();
	}

	reset() {
		this.samples = [];
		this.min = Infinity;
		this.max = 0;
		this.average = 0;
		this.prev = null;
	}

	// position {x, y, z} in metres, time in seconds; true when the speed was updated
	add(position, time) {
		const prev = this.prev;
		if (prev && time - prev.time < 0.01) {
			// the same transform again (or too close to tell); a jump back in time starts over
			if (time < prev.time)
				this.prev = { position, time };
			return false;
		}
		this.prev = { position, time };
		if (!prev)
			return false;
		let speed = Math.hypot(position.x - prev.position.x, position.y - prev.position.y, position.z - prev.position.z) / (time - prev.time);
		if (this.samples.length > 0)
			speed = speed * SMOOTHING + this.samples[this.samples.length - 1] * (1 - SMOOTHING);
		this.samples.push(speed);
		if (this.samples.length > SAMPLE_SIZE)
			this.samples.shift();
		this.average = this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
		this.min = Math.min(this.min, this.average);
		this.max = Math.max(this.max, this.average);
		return true;
	}

	// 0..1 between the slowest and fastest speed seen
	get needle() {
		const span = this.max - this.min;
		return span > 0 ? (this.average - this.min) / span : 0;
	}
}

// How fast a TF frame moves relative to another: a gauge with the speed as the icon; current,
// minimum and maximum speed in the panel.
export class SpeedometerWidget extends WidgetDisplay {

	static type = "speedometer";
	static label = "Speedometer";
	static icon = "assets/speedometer_icon.svg";
	static description = "Speed of a TF frame (from TF), as a gauge, with min / max";
	static properties = {
		frame: { type: "frame", label: "Frame", default: "base_link", noDefault: true },
		fixed_frame: { type: "frame", label: "Relative to", help: "The global fixed frame when empty." },
		units: { type: "enum", label: "Units", default: "m/s", options: Object.keys(SPEED_UNITS).map((value) => ({ value, label: value })) },
		...WIDGET_PROPERTIES,
	};

	// the old template widget saved { state: { frame, fixed_frame, units } }
	static migrateProps(props) {
		if (!props.state)
			return props;
		const { frame, fixed_frame, units } = props.state;
		const out = {};
		if (typeof frame === "string" && frame)
			out.frame = frame;
		if (typeof fixed_frame === "string")
			out.fixed_frame = fixed_frame;
		if (units in SPEED_UNITS)
			out.units = units;
		return out;
	}

	get iconColor() {
		return null;
	}

	get reference() {
		return this.props.fixed_frame || this.ctx.tf.fixed_frame;
	}

	onCreate() {
		this.tracker = new SpeedTracker();
		this.lastIcon = 0;
		this.status.warn("Waiting for TF...");
	}

	onPropertyChange(key) {
		if (key === "frame" || key === "fixed_frame")
			this.tracker.reset();
		this.paint(true);
	}

	onFixedFrameChange() {
		if (!this.props.fixed_frame)
			this.reset();
	}

	reset() {
		this.tracker.reset();
		this.paint(true);
	}

	onTfChange() {
		const tf = this.ctx.tf;
		const frame = this.props.frame;
		const stamp = tf.frame_headerstamps[frame];
		if (!tf.absoluteTransforms[frame] || !stamp) {
			this.status.error(`Frame "${frame}" not found in TF.`);
			return;
		}
		if (!tf.absoluteTransforms[this.reference] && this.reference !== tf.fixed_frame) {
			this.status.error(`Frame "${this.reference}" not found in TF.`);
			return;
		}
		const pose = tf.transformPose(frame, this.reference, { x: 0, y: 0, z: 0 }, new Quaternion());
		this.status.ok();
		if (this.tracker.add(pose.translation, stamp.sec + stamp.nanosec / 1e9))
			this.paint(false);
	}

	paint(now) {
		this.paintPanel();
		// TF can change hundreds of times a second; the icon need not
		const t = performance.now();
		if (now || t - this.lastIcon >= ICON_REFRESH_MS) {
			this.lastIcon = t;
			this.refreshIcon();
		}
	}

	speedText(ms) {
		return Number.isFinite(ms) ? `${(ms * SPEED_UNITS[this.props.units]).toFixed(2)} ${this.props.units}` : "–";
	}

	buildIcon(face) {
		const gauge = document.createElement("img");
		gauge.src = "assets/speedometer.svg";
		gauge.alt = "";
		const needle = document.createElement("img");
		needle.src = "assets/speedometer_dial.svg";
		needle.alt = "";
		needle.style.transition = "transform 0.2s ease";
		const reading = document.createElement("p");
		reading.className = "icon-text-dial";
		const unit = document.createElement("p");
		unit.className = "icon-text-dial-unit";
		face.append(gauge, needle, reading, unit);
		return () => {
			const tracker = this.tracker;
			needle.style.transform = `rotate(${tracker.needle * NEEDLE_SWEEP_DEG}deg)`;
			reading.textContent = formatDial(tracker.average * SPEED_UNITS[this.props.units]);
			unit.textContent = this.props.units;
		};
	}

	buildPanel(container) {
		const list = document.createElement("dl");
		list.className = "readout";
		this.fields = {};
		for (const [key, label] of [["speed", "Speed"], ["min", "Minimum"], ["max", "Maximum"]]) {
			const dt = document.createElement("dt");
			dt.textContent = label;
			const dd = document.createElement("dd");
			list.append(dt, dd);
			this.fields[key] = dd;
		}
		const reset = document.createElement("button");
		reset.type = "button";
		reset.textContent = "Reset tracking";
		reset.title = "Forget the minimum, maximum and averaged samples";
		reset.addEventListener("click", () => this.reset());
		container.append(list, reset);
		this.paintPanel();
	}

	paintPanel() {
		if (!this.fields)
			return;
		const tracker = this.tracker;
		const any = tracker.samples.length > 0;
		this.fields.speed.textContent = any ? this.speedText(tracker.average) : "–";
		this.fields.min.textContent = any ? this.speedText(tracker.min) : "–";
		this.fields.max.textContent = any ? this.speedText(tracker.max) : "–";
	}
}
