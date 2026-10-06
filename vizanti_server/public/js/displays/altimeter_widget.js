import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

// dir: what the tape shows; invert: the robot's Z (and the target topic) count the other way
export const ALTIMETER_MODES = {
	altitude_positive: { dir: "altitude", invert: false, label: "Altitude (Z+)" },
	depth_negative: { dir: "depth", invert: true, label: "Depth (Z-)" },
	altitude_negative: { dir: "altitude", invert: true, label: "Altitude inverted (Z-)" },
	depth_positive: { dir: "depth", invert: false, label: "Depth inverted (Z+)" },
};

const TAPE_WIDTH = 110; // CSS px
const PX_PER_STEP = 100;
const COLORS = { depth: "#4070bf", altitude: "#5a9558" };

// the reading shown for a frame at height z: never negative
export function altimeterMeters(z, mode) {
	const value = ALTIMETER_MODES[mode].invert ? -z : z;
	return Math.max(0, Math.round(value * 1000) / 1000);
}

// a received target value, or NaN when its sign belongs to the other direction
export function altimeterTarget(data, mode) {
	const { invert } = ALTIMETER_MODES[mode];
	if ((data > 0 && invert) || (data < 0 && !invert))
		return NaN;
	return Math.abs(data);
}

// the value to publish for a target of `meters` (positive) on the tape
export function altimeterPublishValue(meters, mode) {
	return ALTIMETER_MODES[mode].invert ? -meters : meters;
}

// the target at `y` CSS px down a tape of height `height` centred on `meters`
export function altimeterTargetAt(y, height, meters, step, mode) {
	const sign = ALTIMETER_MODES[mode].dir === "depth" ? 1 : -1;
	return ((y - height / 2) / PX_PER_STEP * sign + meters / step) * step;
}

let arrows = null;
function arrowImages() {
	const load = (src) => {
		const image = new Image();
		image.src = src;
		return image;
	};
	arrows ??= { depth: load("assets/altimeter_arrow.svg"), altitude: load("assets/altimeter_arrow_green.svg") };
	return arrows;
}

// The height (or depth) of a TF frame as a scrolling tape along one side of the view. With a
// target topic (std_msgs/Float32), the target is marked with a yellow flag, and a click on the
// tape's tick side (or the panel) sends a new one.
export class AltimeterWidget extends WidgetDisplay {

	static type = "altimeter";
	static label = "Altimeter";
	static icon = "assets/altimeter_green.svg";
	static description = "Height or depth of a TF frame as a tape gauge on the view, with a target";
	static msgTypes = ["std_msgs/msg/Float32"];
	static properties = {
		frame: { type: "frame", label: "Robot frame", default: "base_link", noDefault: true },
		mode: { type: "enum", label: "Display mode", default: "altitude_positive",
			options: Object.entries(ALTIMETER_MODES).map(([value, m]) => ({ value, label: m.label })),
			help: "Shows the frame's Z on an altitude or depth tape. The inverted modes count negative Z as positive." },
		step: { type: "float", label: "Step (m)", default: 1, min: 0.1, max: 1000, step: 0.1, help: "Metres between labelled marks." },
		topic: { type: "topic", label: "Target topic", optional: true, help: "std_msgs/Float32. Optional: leave empty for no target." },
		side: { type: "enum", label: "Side", default: "left", options: [{ value: "left", label: "Left" }, { value: "right", label: "Right" }] },
		column: { type: "int", label: "Offset (tape widths)", default: 0, min: 0, max: 20, help: "Places several tapes side by side." },
		...WIDGET_PROPERTIES,
	};

	// the old template widget saved { state: { mode, frame, topic, step, img_offset_x (px) } }
	static migrateProps(props) {
		const s = props.state;
		if (!s)
			return props;
		const out = {};
		if (s.mode in ALTIMETER_MODES)
			out.mode = s.mode;
		if (typeof s.frame === "string" && s.frame)
			out.frame = s.frame;
		if (typeof s.topic === "string")
			out.topic = s.topic;
		const step = parseFloat(s.step);
		if (Number.isFinite(step))
			out.step = step;
		const offset = parseFloat(s.img_offset_x);
		if (Number.isFinite(offset)) {
			const width = globalThis.innerWidth ?? 1920;
			out.side = offset > width / 2 ? "right" : "left";
			const fromEdge = out.side === "right" ? width - offset - TAPE_WIDTH : offset;
			out.column = Math.max(0, Math.round(fromEdge / TAPE_WIDTH));
		}
		return out;
	}

	get iconColor() {
		return null;
	}

	get icon() {
		return ALTIMETER_MODES[this.props.mode]?.dir === "depth" ? "assets/altimeter.svg" : "assets/altimeter_green.svg";
	}

	// the target topic is optional
	get subscribes() {
		return this.props.topic !== "";
	}

	onCreate() {
		this.meters = 0;
		this.smooth = 0;
		this.target = NaN;
		this.tapeRect = null;
		arrowImages();
		this.status.warn("Waiting for TF...");
		this.timer = setInterval(() => this.tick(), 33);
	}

	onDestroy() {
		clearInterval(this.timer);
	}

	onPropertyChange(key) {
		if (key === "mode") {
			this.target = NaN;
			this.refreshIcon();
			this.onTfChange();
		}
		if (key === "frame")
			this.onTfChange();
		if (key === "topic")
			this.target = NaN;
		this.paintPanel();
	}

	onMessage(msg) {
		this.target = altimeterTarget(msg.data, this.props.mode);
		this.paintPanel();
	}

	onTfChange() {
		const frame = this.ctx.tf.absoluteTransforms[this.props.frame];
		if (!frame) {
			this.status.error(`Frame "${this.props.frame}" not found in TF.`);
			return;
		}
		this.status.ok();
		const meters = altimeterMeters(frame.translation.z, this.props.mode);
		if (meters !== this.meters) {
			this.meters = meters;
			this.paintPanel();
		}
	}

	// eases the tape towards the reading
	tick() {
		if (!this.enabled)
			return;
		if (Math.abs(this.meters - this.smooth) > this.props.step * 0.01) {
			this.smooth = this.smooth * 0.8 + this.meters * 0.2;
			this.requestRender();
		} else if (this.smooth !== this.meters) {
			this.smooth = this.meters;
			this.requestRender();
		}
	}

	publishTarget(meters) {
		if (!this.props.topic || !Number.isFinite(meters))
			return;
		this.ctx.publish(this.props.topic, "std_msgs/msg/Float32", { data: altimeterPublishValue(Math.max(0, meters), this.props.mode) });
	}

	onOverlay(ctx, scene) {
		const mode = ALTIMETER_MODES[this.props.mode];
		const flip = this.props.side === "right";
		const height = scene.height;
		const left = flip ? scene.width - TAPE_WIDTH * (this.props.column + 1) : TAPE_WIDTH * this.props.column;
		this.tapeRect = { left, width: TAPE_WIDTH, height, flip };
		const color = COLORS[mode.dir];
		const step = this.props.step;

		ctx.save();
		ctx.beginPath();
		ctx.rect(left, 0, TAPE_WIDTH, height);
		ctx.clip();
		ctx.translate(left, 0);

		const gradient = ctx.createLinearGradient(flip ? TAPE_WIDTH : 0, 0, flip ? 0 : TAPE_WIDTH, 0);
		gradient.addColorStop(0, "rgba(0, 0, 0, 0.59)");
		gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, TAPE_WIDTH, height);
		ctx.fillStyle = color;
		ctx.fillRect(flip ? TAPE_WIDTH - 5 : 0, 0, 5, height);

		// depth grows downwards from the surface line, altitude upwards from the ground
		const sign = mode.dir === "depth" ? 1 : -1;
		const zero = height / 2 - sign * (this.smooth / step) * PX_PER_STEP;
		const edge = flip ? TAPE_WIDTH : 0;
		const dir = flip ? -1 : 1;

		// the sky above the surface, or the ground below zero altitude
		ctx.fillStyle = color;
		ctx.fillRect(flip ? 60 : 0, mode.dir === "depth" ? zero - 50 : zero, 50, 50);

		const inside = (y) => (sign > 0 ? y <= height : y >= 0);
		const before = (y) => (sign > 0 ? y < 0 : y > height);

		ctx.strokeStyle = "lightgray";
		ctx.lineWidth = 1;
		ctx.beginPath();
		for (let i = 0, y = zero; inside(y); i++, y += sign * 10) {
			if (i % 5 === 0 || before(y))
				continue;
			ctx.moveTo(edge, y);
			ctx.lineTo(edge + 25 * dir, y);
		}
		ctx.stroke();

		ctx.strokeStyle = "white";
		ctx.fillStyle = "white";
		ctx.lineWidth = 2;
		ctx.font = "bold 16px monospace";
		ctx.textAlign = flip ? "right" : "left";
		ctx.beginPath();
		for (let i = 0, y = zero; inside(y); i++, y += sign * 50) {
			if (before(y))
				continue;
			const labelled = i % 2 === 0;
			ctx.moveTo(edge, y);
			ctx.lineTo(edge + (labelled ? 50 : 35) * dir, y);
			if (labelled) {
				const value = (i / 2) * step;
				ctx.fillText(Number.isInteger(value) ? String(value) : value.toFixed(1), flip ? TAPE_WIDTH - 55 : 55, y + 4);
			}
		}
		ctx.stroke();

		if (Number.isFinite(this.target)) {
			const y = zero + sign * (this.target / step) * PX_PER_STEP;
			ctx.fillStyle = "#e3df6f";
			ctx.beginPath();
			ctx.moveTo(edge, y - 25);
			ctx.lineTo(edge + 25 * dir, y);
			ctx.lineTo(edge, y + 25);
			ctx.closePath();
			ctx.fill();
		}

		// the pointer at the current reading
		const arrow = arrowImages()[mode.dir];
		if (arrow.complete && arrow.naturalWidth > 0) {
			ctx.translate(flip ? TAPE_WIDTH : 0, height / 2);
			if (flip)
				ctx.rotate(Math.PI);
			ctx.drawImage(arrow, 0, -27.5, 55, 55);
		}
		ctx.restore();
	}

	// a click on the tick side of the tape sends that target
	onHudPointer(kind, { x, y }) {
		const tape = this.tapeRect;
		if (kind === "down") {
			if (!tape || !this.props.topic)
				return false;
			const local = tape.flip ? tape.left + tape.width - x : x - tape.left;
			if (local < 0 || local > 30)
				return false;
			this.press = { x, y };
			return true;
		}
		if (kind === "up" && this.press) {
			const press = this.press;
			this.press = null;
			if (Math.hypot(x - press.x, y - press.y) < 15) {
				const target = altimeterTargetAt(y, tape.height, this.smooth, this.props.step, this.props.mode);
				if (target > -1)
					this.publishTarget(target);
			}
		}
		return true;
	}

	buildPanel(container) {
		const list = document.createElement("dl");
		list.className = "readout";
		this.fields = {};
		for (const key of ["reading", "target"]) {
			const dt = document.createElement("dt");
			const dd = document.createElement("dd");
			list.append(dt, dd);
			this.fields[key] = { dt, dd };
		}
		const form = document.createElement("form");
		form.className = "widget_row";
		const input = document.createElement("input");
		input.type = "number";
		input.min = "0";
		input.step = "0.1";
		input.value = "0";
		input.setAttribute("aria-label", "Target (m)");
		const send = document.createElement("button");
		send.type = "submit";
		send.textContent = "Send target";
		form.append(input, send);
		form.addEventListener("submit", (event) => {
			event.preventDefault();
			this.publishTarget(Math.abs(parseFloat(input.value)));
		});
		this.sendForm = form;
		const note = document.createElement("p");
		note.className = "comment";
		note.textContent = "With a target topic set, clicking the tape near its ticks also sends a target.";
		container.append(list, form, note);
		this.paintPanel();
	}

	paintPanel() {
		if (!this.fields)
			return;
		const dir = ALTIMETER_MODES[this.props.mode].dir;
		this.fields.reading.dt.textContent = dir === "depth" ? "Depth" : "Altitude";
		this.fields.reading.dd.textContent = `${this.meters.toFixed(3)} m`;
		this.fields.target.dt.textContent = "Target";
		this.fields.target.dd.textContent = !this.props.topic ? "No target topic" : Number.isFinite(this.target) ? `${this.target.toFixed(3)} m` : "–";
		for (const element of this.sendForm.elements)
			element.disabled = !this.props.topic;
	}
}
