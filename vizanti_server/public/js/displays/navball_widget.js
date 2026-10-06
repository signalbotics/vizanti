import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';
import { navballLut, navballAngles, renderNavball, headingFromYaw, quaternionValid, ImuFusion } from '../geometry/navball.js';

const MODES = [
	{ value: "horizon_fake", label: "Pilot (inside-out)" },
	{ value: "horizon_true", label: "Inertial reference (outside-in)" },
	{ value: "external", label: "Observer (direct rotation)" },
];
const ANGLE_DELTA = 0.001; // the summed angles must move this much (rad) to redraw
const TICK_MS = 33;
const MAX_PIXELS = 600; // the ball's resolution is capped; it is scaled up beyond that

// The textures, loaded once for every attitude indicator.
let images = null;
function loadImages() {
	const load = (src) => new Promise((resolve, reject) => {
		const image = new Image();
		image.onload = () => resolve(image);
		image.onerror = () => reject(new Error(`Could not load ${src}`));
		image.src = src;
	});
	const pixels = (image) => {
		const canvas = document.createElement("canvas");
		canvas.width = image.width;
		canvas.height = image.height;
		const ctx = canvas.getContext("2d");
		ctx.drawImage(image, 0, 0);
		return ctx.getImageData(0, 0, image.width, image.height);
	};
	images ??= Promise.all([
		load("assets/navball_texture.jpg"), load("assets/navball_invtex.jpg"),
		load("assets/navball_center.png"), load("assets/navball_overlay.png"),
	]).then(([texture, inverted, center, overlay]) => ({
		texture: pixels(texture), inverted: pixels(inverted), center, overlay,
	}));
	return images;
}

const deg = (rad) => `${(rad * 180 / Math.PI).toFixed(0)}°`;

// An attitude indicator ("navball") drawn on the view, from an IMU topic or a TF frame's
// orientation. Drag the ball to move it.
export class NavballWidget extends WidgetDisplay {

	static type = "navball";
	static label = "Attitude Indicator";
	static icon = "assets/navball_icon.svg";
	static description = "Navball on the view: attitude from sensor_msgs/Imu or a TF frame";
	static msgTypes = ["sensor_msgs/msg/Imu"];
	static properties = {
		source: { type: "enum", label: "Source", default: "imu", options: [{ value: "imu", label: "IMU topic" }, { value: "tf", label: "TF frame" }] },
		topic: { type: "topic", label: "IMU topic" },
		frame: { type: "frame", label: "TF frame", default: "base_link", noDefault: true },
		mode: { type: "enum", label: "Mode", default: "horizon_fake", options: MODES,
			help: "Pilot: an artificial horizon that moves against the vehicle's motion. Inertial reference: a ball fixed to the world. Observer: the ball turns the way the vehicle does." },
		alt_roll: { type: "bool", label: "Show roll on the indicator line", default: false },
		opacity: { type: "float", label: "Opacity", default: 0.85, min: 0.1, max: 1, step: 0.05 },
		width: { type: "int", label: "Size (% of view width)", default: 10, min: 5, max: 50 },
		pos_x: { type: "float", label: "Position X (%)", default: 50, min: 0, max: 100, step: 1, help: "Or drag the ball." },
		pos_y: { type: "float", label: "Position Y (%)", default: 85, min: 0, max: 100, step: 1 },
		throttle: { type: "int", label: "Throttle (ms)", default: 30, min: 0, max: 10000 },
		...WIDGET_PROPERTIES,
	};

	// the old template widget saved { state: { topic: "<name> (Imu)" | "<frame> (Frame)", opacity,
	// throttle, width, offset_x, offset_y (vw / vh), angle_mode, alt_roll } }, numbers as text
	static migrateProps(props) {
		const s = props.state;
		if (!s)
			return props;
		const out = {};
		const target = typeof s.topic === "string" ? s.topic : "";
		if (target.endsWith(" (Frame)")) {
			out.source = "tf";
			out.frame = target.slice(0, -" (Frame)".length);
		} else {
			out.topic = target.replace(/ \(Imu\)$/, "");
		}
		for (const [from, to] of [["opacity", "opacity"], ["throttle", "throttle"], ["width", "width"], ["offset_x", "pos_x"], ["offset_y", "pos_y"]]) {
			const value = parseFloat(s[from]);
			if (Number.isFinite(value))
				out[to] = to === "throttle" || to === "width" ? Math.round(value) : value;
		}
		if (MODES.some((m) => m.value === s.angle_mode))
			out.mode = s.angle_mode;
		if (typeof s.alt_roll === "boolean")
			out.alt_roll = s.alt_roll;
		return out;
	}

	get iconColor() {
		return null;
	}

	get subscribes() {
		return this.props.source === "imu";
	}

	onCreate() {
		this.quat = new Quaternion();
		this.smooth = new Quaternion();
		this.fusion = new ImuFusion();
		this.prev = null;
		this.dirty = true;
		this.lastTf = 0;
		this.ball = document.createElement("canvas");
		this.ballCtx = this.ball.getContext("2d", { willReadFrequently: true });
		this.hudRect = null;
		if (this.props.source === "tf")
			this.status.warn("Waiting for TF...");
		loadImages().then((loaded) => {
			this.images = loaded;
			this.dirty = true;
		}, (e) => this.status.error(e.message));
		this.timer = setInterval(() => this.tick(), TICK_MS);
	}

	onDestroy() {
		clearInterval(this.timer);
	}

	onPropertyChange(key) {
		if (key === "source") {
			this.quat = new Quaternion();
			this.fusion = new ImuFusion();
			this._resubscribe();
			if (this.props.source === "tf") {
				this.status.warn("Waiting for TF...");
				this.onTfChange();
			}
		}
		this.dirty = true;
		this.paintPanel();
	}

	onMessage(msg) {
		const q = msg.orientation;
		if (quaternionValid(q)) {
			this.quat = new Quaternion(q.w, q.x, q.y, q.z);
			this.status.ok();
		} else {
			const { quat, note } = this.fusion.update(msg, this.quat);
			this.quat = quat;
			this.status.warn(note);
		}
		this.frameId = msg.header.frame_id;
		this.paintPanel();
	}

	onTfChange() {
		if (this.props.source !== "tf")
			return;
		const now = performance.now();
		if (now - this.lastTf < this.props.throttle)
			return;
		this.lastTf = now;
		const frame = this.ctx.tf.absoluteTransforms[this.props.frame];
		if (!frame) {
			this.status.error(`Frame "${this.props.frame}" not found in TF.`);
			return;
		}
		this.quat = new Quaternion(frame.rotation);
		this.frameId = this.props.frame;
		this.status.ok();
		this.paintPanel();
	}

	// eases the drawn attitude towards the latest one and redraws the ball when it moved
	tick() {
		if (!this.enabled || !this.images)
			return;
		this.smooth = this.smooth.slerp(this.quat)(0.1);
		const e = this.smooth.toEuler();
		const attitude = { roll: e.g, pitch: e.pitch, yaw: e.h };
		const prev = this.prev;
		if (!this.dirty && prev && Math.abs(prev.roll - attitude.roll) + Math.abs(prev.pitch - attitude.pitch) + Math.abs(prev.yaw - attitude.yaw) < ANGLE_DELTA)
			return;
		this.prev = attitude;
		this.dirty = false;
		this.drawBall(attitude);
		this.paintPreview();
		this.requestRender();
	}

	ballPixels() {
		const scene = this.ctx.scene;
		const css = Math.max(16, Math.round(this.props.width / 100 * (scene?.width ?? 800)));
		return Math.min(MAX_PIXELS, Math.round(css * (window.devicePixelRatio || 1)));
	}

	drawBall(attitude) {
		const size = this.ballPixels();
		if (this.ball.width !== size || !this.lut) {
			this.ball.width = this.ball.height = size;
			this.lut = navballLut(size);
			this.imageData = this.ballCtx.createImageData(size, size);
		}
		const angles = navballAngles(attitude, this.props.mode, this.props.alt_roll);
		renderNavball(this.lut, this.imageData.data, angles.inverted ? this.images.inverted : this.images.texture, angles);
		const ctx = this.ballCtx;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.putImageData(this.imageData, 0, 0);
		const half = size / 2;
		ctx.setTransform(1, 0, 0, 1, half, half);
		if (this.props.alt_roll)
			ctx.rotate(angles.trueRoll);
		ctx.drawImage(this.images.center, -half, -half, size, size);
		ctx.setTransform(1, 0, 0, 1, half, half);
		if (!this.props.alt_roll)
			ctx.rotate(angles.trueRoll);
		ctx.drawImage(this.images.overlay, -half, -half, size, size);
		ctx.setTransform(1, 0, 0, 1, 0, 0);
	}

	onOverlay(ctx, scene) {
		if (!this.prev)
			return;
		const size = Math.round(this.props.width / 100 * scene.width);
		const x = Math.min(Math.max(this.props.pos_x / 100 * scene.width, size * 0.3), scene.width - size * 0.3) - size / 2;
		const y = Math.min(Math.max(this.props.pos_y / 100 * scene.height, size * 0.3), scene.height - size * 0.3) - size / 2;
		this.hudRect = { x, y, size };
		ctx.save();
		ctx.globalAlpha = this.props.opacity;
		ctx.drawImage(this.ball, x, y, size, size);
		ctx.restore();
	}

	// drag the ball around the view
	onHudPointer(kind, { x, y }) {
		const rect = this.hudRect;
		const scene = this.ctx.scene;
		if (kind === "down") {
			if (!rect || Math.hypot(x - (rect.x + rect.size / 2), y - (rect.y + rect.size / 2)) > rect.size * 0.45)
				return false;
			this.drag = { dx: rect.x + rect.size / 2 - x, dy: rect.y + rect.size / 2 - y };
			return true;
		}
		if (!this.drag)
			return false;
		const px = Math.min(100, Math.max(0, (x + this.drag.dx) / scene.width * 100));
		const py = Math.min(100, Math.max(0, (y + this.drag.dy) / scene.height * 100));
		if (kind === "move") {
			this.props.pos_x = px; // saved when the drag ends
			this.props.pos_y = py;
			this.requestRender();
		} else {
			this.drag = null;
			this.setProp("pos_x", Math.round(px * 10) / 10);
			this.setProp("pos_y", Math.round(py * 10) / 10);
		}
		return true;
	}

	buildPanel(container) {
		this.preview = document.createElement("canvas");
		this.preview.width = this.preview.height = 160;
		this.preview.className = "navball_preview";
		const list = document.createElement("dl");
		list.className = "readout";
		this.fields = {};
		for (const [key, label] of [["pitch", "Pitch"], ["roll", "Roll"], ["yaw", "Yaw"], ["heading", "Heading"],
			["accel", "Acceleration"], ["gyro", "Angular velocity"], ["quat", "Quaternion (xyzw)"], ["frame", "Frame"]]) {
			const dt = document.createElement("dt");
			dt.textContent = label;
			const dd = document.createElement("dd");
			list.append(dt, dd);
			this.fields[key] = dd;
		}
		container.append(this.preview, list);
		this.paintPanel();
		this.paintPreview();
	}

	paintPreview() {
		if (!this.preview?.isConnected || !this.prev)
			return;
		const ctx = this.preview.getContext("2d");
		ctx.clearRect(0, 0, 160, 160);
		ctx.drawImage(this.ball, 0, 0, 160, 160);
	}

	paintPanel() {
		if (!this.fields)
			return;
		const q = this.quat;
		const e = q.toEuler();
		const f = this.fields;
		f.pitch.textContent = deg(e.pitch);
		f.roll.textContent = deg(e.g);
		f.yaw.textContent = deg(e.h);
		f.heading.textContent = `${headingFromYaw(e.h).toFixed(0)}°`;
		const msg = this.props.source === "imu" ? this.lastMsg : null;
		const v = (vec) => `${vec.x.toFixed(2)}, ${vec.y.toFixed(2)}, ${vec.z.toFixed(2)}`;
		f.accel.textContent = msg ? `${v(msg.linear_acceleration)} m/s²` : "–";
		f.gyro.textContent = msg ? `${v(msg.angular_velocity)} rad/s` : "–";
		f.quat.textContent = [q.x, q.y, q.z, q.w].map((n) => n.toFixed(3)).join(", ");
		f.frame.textContent = this.frameId || "–";
	}
}
