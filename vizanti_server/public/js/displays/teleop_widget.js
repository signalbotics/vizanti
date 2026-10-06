import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';
import { AXES, AXIS_LABELS, DEFAULT_KEYS, PRESETS, RATE_HZ, TeleopDrive, keyLabel, presetProps } from '../geometry/teleop.js';

const TWIST = "geometry_msgs/msg/Twist";
const TWIST_STAMPED = "geometry_msgs/msg/TwistStamped";
const KEYS = ["key_up", "key_down", "key_left", "key_right"];
const ZERO = () => ({ linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } });

const axisOptions = AXES.map((value) => ({ value, label: AXIS_LABELS[value] }));

// keys typed into a field are not driving commands
const typing = (event) => {
	const t = event.target;
	return t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
};

// A virtual joystick (and optionally the keyboard) that publishes Twist / TwistStamped.
export class TeleopWidget extends WidgetDisplay {

	static type = "teleop";
	static label = "Joystick Teleop";
	static icon = "assets/joystick_color.svg";
	static description = "On-screen joystick and keyboard driving (geometry_msgs/Twist or TwistStamped)";
	static msgTypes = [TWIST, TWIST_STAMPED];
	static properties = {
		topic: { type: "topic", label: "Topic", default: "/cmd_vel" },
		topic_type: { type: "string", hidden: true, default: "" },
		frame: { type: "frame", label: "Stamp frame", help: "header.frame_id of a TwistStamped; the fixed frame when empty." },
		axis_vert: { type: "enum", label: "Up/down axis", default: "linear_x", options: axisOptions },
		vel_vert: { type: "float", label: "Up/down max speed", default: 1, min: 0.05, max: 5, step: 0.05 },
		accel_vert: { type: "float", label: "Up/down acceleration", default: 2, min: 0.5, max: 12, step: 0.5, help: "Per second; 12 means instant." },
		invert_vert: { type: "bool", label: "Invert up/down", default: false },
		axis_horiz: { type: "enum", label: "Left/right axis", default: "angular_z", options: axisOptions },
		vel_horiz: { type: "float", label: "Left/right max speed", default: 2, min: 0.05, max: 5, step: 0.05 },
		accel_horiz: { type: "float", label: "Left/right acceleration", default: 4, min: 0.5, max: 12, step: 0.5, help: "Per second; 12 means instant." },
		invert_horiz: { type: "bool", label: "Invert left/right", default: false },
		ackermann_emulation: { type: "bool", label: "Steer like a car in reverse", default: true, help: "Swaps left/right while backing up, as a car does (for diff drive)." },
		instant_stop: { type: "bool", label: "Instant stop", default: false, help: "Sends zero at once on release instead of slowing down." },
		keyboard: { type: "bool", label: "Keyboard driving", default: false, help: "Keys are set in the panel (W A S D by default)." },
		keybindings: { type: "object", default: { ...DEFAULT_KEYS }, hidden: true },
		locked: { type: "bool", label: "Locked", default: false, help: "Hides the stick and ignores the keys. Right-click (RViz UI) or long-press (touch UI) the icon to toggle." },
		color: { type: "color", label: "Colour", default: "#ffffff" },
		opacity: { type: "float", label: "Opacity", default: 0.6, min: 0.1, max: 0.7, step: 0.05 },
		size: { type: "int", label: "Size (px)", default: 150, min: 80, max: 400 },
		pos_x: { type: "float", label: "Position X (%)", default: 50, min: 0, max: 100, step: 1, help: "Or drag the grip next to the stick while the panel is open." },
		pos_y: { type: "float", label: "Position Y (%)", default: 85, min: 0, max: 100, step: 1 },
		...WIDGET_PROPERTIES,
	};

	static propsForTopic(topic, type) {
		return { topic, topic_type: type ?? "" };
	}

	// the old template widget's settings (both of its formats)
	static migrateProps(props) {
		const s = props.state;
		if (!s)
			return props;
		const out = {};
		const num = (v) => (v === undefined || v === null || v === "" ? NaN : Number(v));
		if (typeof s.topic === "string" && s.topic)
			out.topic = s.topic;
		if ([TWIST, TWIST_STAMPED].includes(s.typedict?.[s.topic]))
			out.topic_type = s.typedict[s.topic];
		if (typeof s.color === "string" && /^#[0-9a-f]{6}$/i.test(s.color))
			out.color = s.color;
		if (Number.isFinite(num(s.opacity)))
			out.opacity = Math.min(0.7, Math.max(0.1, num(s.opacity)));
		const pct = (v) => parseFloat(String(v ?? "").replace("%", ""));
		if (Number.isFinite(pct(s.joy_offset_x)))
			out.pos_x = pct(s.joy_offset_x);
		if (Number.isFinite(pct(s.joy_offset_y)))
			out.pos_y = pct(s.joy_offset_y);
		if (typeof s.joy_locked === "boolean")
			out.locked = s.joy_locked;
		if (s.linear_velocity !== undefined) {
			// the oldest format: one acceleration at 20 Hz steps, a swap for holonomic robots
			out.vel_vert = num(s.linear_velocity);
			out.vel_horiz = num(s.angular_velocity);
			const accel = num(s.accel) * 20;
			if (Number.isFinite(accel))
				out.accel_vert = out.accel_horiz = accel;
			out.axis_vert = "linear_x";
			out.axis_horiz = s.holonomic_swap ? "linear_y" : "angular_z";
			out.ackermann_emulation = !!s.invert_angular;
			return out;
		}
		for (const key of ["axis_vert", "axis_horiz"])
			if (AXES.includes(s[key]))
				out[key] = s[key];
		for (const key of ["vel_vert", "vel_horiz", "accel_vert", "accel_horiz"])
			if (Number.isFinite(num(s[key])))
				out[key] = num(s[key]);
		for (const key of ["invert_vert", "invert_horiz", "ackermann_emulation", "instant_stop"])
			if (typeof s[key] === "boolean")
				out[key] = s[key];
		if (typeof s.keyboard_control === "boolean")
			out.keyboard = s.keyboard_control;
		if (s.keybindings && KEYS.every((k) => typeof s.keybindings[k] === "string"))
			out.keybindings = { ...s.keybindings };
		return out;
	}

	get iconColor() {
		return this.props.color;
	}

	get icon() {
		return this.props.locked ? "assets/joystick_locked.svg" : "assets/joystick_color.svg";
	}

	get longPressHint() {
		return this.props.locked ? "unlock" : "lock";
	}

	// it publishes; it never listens
	get subscribes() {
		return false;
	}

	onIconLongPress() {
		this.setProp("locked", !this.props.locked);
	}

	onCreate() {
		this.drive = new TeleopDrive();
		this.pressed = new Set();
		this.listening = null; // the key binding waiting for a key

		this.zone = document.createElement("div");
		this.zone.className = "teleop_zone noselect";
		this.grip = document.createElement("div");
		this.grip.className = "teleop_grip";
		this.grip.title = "Drag to move the joystick";
		this.grip.textContent = "✥";
		this.labels = {};
		for (const key of KEYS) {
			const label = document.createElement("span");
			label.className = `teleop_key teleop_${key}`;
			this.labels[key] = label;
			this.zone.appendChild(label);
		}
		this.zone.appendChild(this.grip);
		this.ctx.scene?.container.appendChild(this.zone);
		this.grip.addEventListener("pointerdown", (event) => this.startDrag(event));

		this.onKeyDown = (event) => this.keyDown(event);
		this.onKeyUp = (event) => this.keyUp(event);
		document.addEventListener("keydown", this.onKeyDown);
		document.addEventListener("keyup", this.onKeyUp);
		// losing focus while a key or the stick is held must not leave the robot driving
		this.onBlur = () => this.stopAll();
		this.onVisibility = () => {
			if (document.hidden)
				this.stopAll();
		};
		window.addEventListener("blur", this.onBlur);
		document.addEventListener("visibilitychange", this.onVisibility);

		this.lookupType();
		this.layout();
		this.buildStick();
	}

	onDestroy() {
		this.stopAll();
		this.stick?.destroy();
		this.stick = null;
		this.zone.remove();
		document.removeEventListener("keydown", this.onKeyDown);
		document.removeEventListener("keyup", this.onKeyUp);
		window.removeEventListener("blur", this.onBlur);
		document.removeEventListener("visibilitychange", this.onVisibility);
	}

	_setEnabled(enabled) {
		super._setEnabled(enabled);
		if (!enabled)
			this.stopAll();
		this.layout();
	}

	onPropertyChange(key) {
		if (key === "topic") {
			this.stopAll();
			this.lookupType();
		}
		if (key === "locked") {
			this.stopAll();
			this.refreshIcon();
		}
		if (["color", "opacity", "size"].includes(key))
			this.buildStick();
		this.layout();
		this.paintPanel();
	}

	// Twist or TwistStamped, as the graph has it; Twist when nothing has the topic yet
	async lookupType() {
		const topic = this.props.topic;
		if (!topic) {
			this.status.error("No topic chosen.");
			return;
		}
		if ([TWIST, TWIST_STAMPED].includes(this.props.topic_type)) {
			this.status.ok();
			return;
		}
		const type = await this.ctx.resolveType?.(topic);
		if (!this._alive || this.props.topic !== topic)
			return;
		if (type && ![TWIST, TWIST_STAMPED].includes(type)) {
			this.status.error(`${topic} is a ${type}, not a Twist or TwistStamped.`);
			return;
		}
		if (type)
			this.setProp("topic_type", type);
		else
			this.status.warn(`Nothing uses ${topic} yet; sending geometry_msgs/Twist.`);
	}

	get messageType() {
		return this.props.topic_type || TWIST;
	}

	// ---- the stick ----

	layout() {
		if (!this.zone)
			return;
		const p = this.props;
		const side = p.size + 30;
		Object.assign(this.zone.style, {
			left: `${p.pos_x}%`,
			top: `${p.pos_y}%`,
			width: `${side}px`,
			height: `${side}px`,
			display: this.enabled && !p.locked ? "block" : "none",
		});
		this.grip.style.display = p.show_panel ? "block" : "none";
		const binds = { ...DEFAULT_KEYS, ...p.keybindings };
		for (const key of KEYS)
			this.labels[key].textContent = p.keyboard && this.axisOn(key) ? keyLabel(binds[key]) : "";
	}

	axisOn(key) {
		return (key === "key_up" || key === "key_down") ? this.props.axis_vert !== "none" : this.props.axis_horiz !== "none";
	}

	async buildStick() {
		const { nipplejs } = await import('../modules/joystick.js');
		if (!this._alive)
			return;
		this.stick?.destroy();
		this.stick = nipplejs.create({
			zone: this.zone,
			mode: "static",
			position: { left: "50%", top: "50%" },
			size: this.props.size,
			threshold: 0.1,
			color: this.props.color,
			restOpacity: this.props.opacity + 0.3,
		});
		this.stick.on("move", (event, data) => {
			if (this.props.locked || !this.enabled)
				return;
			this.drive.setTargets(this.props, { angle: data.angle.radian, force: data.force });
			this.run();
		});
		this.stick.on("end", () => this.drive.release(this.props));
	}

	startDrag(event) {
		event.preventDefault();
		event.stopPropagation();
		const container = this.ctx.scene.container;
		const move = (e) => {
			const rect = container.getBoundingClientRect();
			this.props.pos_x = Math.min(100, Math.max(0, (e.clientX - rect.left) / rect.width * 100));
			this.props.pos_y = Math.min(100, Math.max(0, (e.clientY - rect.top) / rect.height * 100));
			this.layout(); // saved when the drag ends
		};
		const up = () => {
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", up);
			this.setProp("pos_x", Math.round(this.props.pos_x * 10) / 10);
			this.setProp("pos_y", Math.round(this.props.pos_y * 10) / 10);
		};
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", up);
	}

	// ---- driving ----

	run() {
		if (this.loop)
			return;
		this.loop = setInterval(() => {
			const twist = this.drive.step(this.props);
			if (twist) {
				this.send(twist);
				return;
			}
			this.send(ZERO());
			clearInterval(this.loop);
			this.loop = null;
		}, 1000 / RATE_HZ);
	}

	// stop now, with a zero twist if anything was moving
	stopAll() {
		this.pressed?.clear();
		if (!this.drive)
			return;
		const wasMoving = this.drive.moving || !!this.loop;
		this.drive.stop();
		clearInterval(this.loop);
		this.loop = null;
		if (wasMoving)
			this.send(ZERO());
	}

	send(twist) {
		this.lastTwist = twist;
		if (!this.props.topic)
			return;
		if (this.messageType === TWIST_STAMPED) {
			const now = Date.now();
			const header = { frame_id: this.props.frame || this.ctx.tf.fixed_frame, stamp: { sec: Math.floor(now / 1000), nanosec: (now % 1000) * 1e6 } };
			this.ctx.publish(this.props.topic, TWIST_STAMPED, { header, twist });
		} else {
			this.ctx.publish(this.props.topic, TWIST, twist);
		}
		this.paintOutput();
	}

	keyDown(event) {
		if (event.key === undefined)
			return;
		const key = event.key.toLowerCase();
		if (this.listening) {
			event.preventDefault();
			const binds = { ...DEFAULT_KEYS, ...this.props.keybindings, [this.listening]: key };
			this.listening = null;
			this.setProp("keybindings", binds);
			return;
		}
		if (!this.props.keyboard || this.props.locked || !this.enabled || typing(event))
			return;
		const action = this.actionFor(key);
		if (!action)
			return; // not ours: another teleop may use it
		event.preventDefault();
		this.pressed.add(action);
		this.keyTargets();
		this.run();
	}

	keyUp(event) {
		if (event.key === undefined || !this.props.keyboard)
			return;
		const action = this.actionFor(event.key.toLowerCase());
		if (!action || !this.pressed.delete(action))
			return;
		if (this.pressed.size === 0)
			this.drive.release(this.props);
		else
			this.keyTargets();
	}

	actionFor(key) {
		const binds = { ...DEFAULT_KEYS, ...this.props.keybindings };
		return KEYS.find((k) => binds[k] === key && this.axisOn(k)) ?? null;
	}

	keyTargets() {
		const vert = (this.pressed.has("key_up") ? 1 : 0) - (this.pressed.has("key_down") ? 1 : 0);
		const horiz = (this.pressed.has("key_right") ? 1 : 0) - (this.pressed.has("key_left") ? 1 : 0);
		this.drive.setTargets(this.props, { vert, horiz });
		if (this.props.instant_stop) {
			// a released axis stops at once
			if (vert === 0)
				this.drive.vert = 0;
			if (horiz === 0)
				this.drive.horiz = 0;
		}
	}

	// ---- panel ----

	buildPanel(container) {
		const presetRow = document.createElement("div");
		presetRow.className = "widget_row";
		const preset = document.createElement("select");
		preset.setAttribute("aria-label", "Preset");
		preset.append(new Option("Apply a preset...", ""), ...Object.entries(PRESETS).map(([name, p]) => new Option(p.label, name)));
		preset.addEventListener("change", () => {
			const values = presetProps(preset.value);
			preset.value = "";
			if (values)
				for (const [key, value] of Object.entries(values))
					this.setProp(key, value);
		});
		this.lockButton = document.createElement("button");
		this.lockButton.type = "button";
		this.lockButton.addEventListener("click", () => this.onIconLongPress());
		presetRow.append(preset, this.lockButton);

		this.output = document.createElement("dl");
		this.output.className = "readout";
		this.outputFields = {};
		for (const [key, label] of [["topic", "Topic"], ["linear", "Linear"], ["angular", "Angular"]]) {
			const dt = document.createElement("dt");
			dt.textContent = label;
			const dd = document.createElement("dd");
			this.output.append(dt, dd);
			this.outputFields[key] = dd;
		}

		const keysHeading = document.createElement("h4");
		keysHeading.textContent = "Keys";
		this.keyNote = document.createElement("p");
		this.keyNote.className = "comment";
		const keys = document.createElement("div");
		keys.className = "teleop_keys";
		this.keyButtons = {};
		for (const key of KEYS) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = `teleop_keybind teleop_${key}`;
			button.addEventListener("click", () => {
				this.listening = key;
				this.paintPanel();
			});
			keys.appendChild(button);
			this.keyButtons[key] = button;
		}
		const note = document.createElement("p");
		note.className = "comment";
		note.textContent = "Drag the ✥ grip by the stick to move it (shown while this panel is open).";
		container.append(presetRow, this.output, keysHeading, this.keyNote, keys, note);
		this.paintPanel();
	}

	paintPanel() {
		if (!this.lockButton)
			return;
		this.lockButton.textContent = this.props.locked ? "Unlock" : "Lock";
		this.keyNote.textContent = this.props.keyboard
			? "Click a key, then press the key to use for it."
			: "Keyboard driving is off (turn it on in the settings). Keys can still be set here.";
		const binds = { ...DEFAULT_KEYS, ...this.props.keybindings };
		for (const key of KEYS) {
			const button = this.keyButtons[key];
			button.disabled = !this.axisOn(key);
			button.textContent = this.listening === key ? "?" : this.axisOn(key) ? keyLabel(binds[key]) : "";
			button.classList.toggle("listening", this.listening === key);
		}
		this.paintOutput();
	}

	paintOutput() {
		if (!this.outputFields)
			return;
		const t = this.lastTwist;
		const v = (o) => `${o.x.toFixed(2)}, ${o.y.toFixed(2)}, ${o.z.toFixed(2)}`;
		this.outputFields.topic.textContent = `${this.props.topic} (${this.messageType.split("/").pop()})`;
		this.outputFields.linear.textContent = t ? v(t.linear) : "–";
		this.outputFields.angular.textContent = t ? v(t.angular) : "–";
	}
}
