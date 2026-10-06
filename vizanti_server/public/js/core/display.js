import * as THREE from '../lib/three.module.min.js';
import { qosRequest } from './qos.js';
import { rotateVector } from '../geometry/tf.js';

export class DisplayStatus {

	constructor() {
		this.level = "ok";
		this.text = "Ok";
		this.onChange = null;
		this.touched = false;
	}

	_set(level, text) {
		this.touched = true;
		if (level === this.level && text === this.text)
			return;
		this.level = level;
		this.text = text;
		if (this.onChange)
			this.onChange(this);
	}

	ok(text = "Ok") { this._set("ok", text); }
	warn(text) { this._set("warn", text); }
	error(text) { this._set("error", text); }
}

// Base class for everything drawn in the 3D scene. A subclass declares its properties as
// data and implements the on* hooks; subscription, frames, status and saving are handled here.
// how long a display in "auto" QoS waits for data before subscribing again
const NO_DATA_RESUBSCRIBE_MS = 5000;

export class Display {

	static kind = "display";
	static type = "";
	static label = "";
	static icon = "";
	static description = "";
	static msgTypes = [];
	static properties = {};
	// Transparent objects draw in list order, so a flat ground layer (map, satellite) lower
	// in the list would paint over scans and TF. Lower layers always draw first.
	static drawLayer = 0;

	// Initial properties for a display added from the "By Topic" list.
	static propsForTopic(topic, type) {
		const props = { topic };
		if (this.msgTypes.length > 1)
			props.topic_type = type ?? "";
		return props;
	}

	constructor(id, ctx) {
		this.id = id;
		this.ctx = ctx;
		this.name = this.constructor.label;
		this.props = {};
		this.enabled = true;
		this.info = {};
		this.order = this.constructor.drawLayer * 100000;
		this.lastMsg = null;
		this.status = new DisplayStatus();
		this.onInfo = null;

		this.root = new THREE.Group();
		this.root.name = id;
		this.root.userData.display = this; // lets the select tool find who drew a clicked object

		this._alive = false;
		this._unsubscribe = null;
		this._subscribeSeq = 0;
		this._overlayFn = null;
	}

	get icon() {
		return this.constructor.icon;
	}

	// colour the shells tint this display's icon with, or null to leave it as drawn
	get iconColor() {
		return this.props.color ?? this.props.colour ?? null;
	}

	// the message type being received; displays that accept several declare a hidden
	// `topic_type` property, which the framework fills in
	get topicType() {
		return this.props.topic_type || this.constructor.msgTypes[0];
	}

	// ---- hooks ----

	onCreate() {}
	onMessage(msg) {}
	onPropertyChange(key, value) {}
	onDestroy() {}
	onTfChange() {}
	onFixedFrameChange() {}
	onCameraChange() {}
	onContextRestored() {}

	// ---- helpers for subclasses ----

	add(object) {
		object.renderOrder = this.order;
		this.root.add(object);
		return object;
	}

	// Places this.root at the frame named in the header.
	//   follow: false -> snapshot of the transform nearest the header stamp
	//   follow: true  -> child of the live frame node, so it moves with TF
	setFrame(header, { follow = false } = {}) {
		const tf = this.ctx.tf;
		let frame = header.frame_id;
		if (frame === "") {
			this.status.warn("Transform frame is an empty string, falling back to fixed frame. Fix your publisher ;)");
			frame = tf.fixed_frame;
		}

		if (follow) {
			const node = this.ctx.frames.get(frame);
			if (!node) {
				this.status.error(`Required transform frame "${frame}" not found.`);
				return false;
			}
			if (this.root.parent !== node)
				node.add(this.root);
			this.root.position.set(0, 0, 0);
			this.root.quaternion.set(0, 0, 0, 1);
			return true;
		}

		let abs = tf.getAbsoluteTransform({ frame_id: frame, stamp: header.stamp });
		if (!abs && frame === tf.fixed_frame)
			abs = { translation: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } };
		if (!abs) {
			this.status.error(`Required transform frame "${frame}" not found.`);
			return false;
		}
		if (this.root.parent !== this.ctx.frames.root)
			this.ctx.frames.root.add(this.root);
		this.root.position.set(abs.translation.x, abs.translation.y, abs.translation.z);
		this.root.quaternion.set(abs.rotation.x, abs.rotation.y, abs.rotation.z, abs.rotation.w);
		return true;
	}

	// A point given in the header's frame, expressed in the fixed frame as it was when the
	// message arrived. Returns null (and sets an error status) when the frame is unknown.
	toFixed(header, point) {
		const tf = this.ctx.tf;
		const frame = header.frame_id === "" ? tf.fixed_frame : header.frame_id;
		const abs = tf.getAbsoluteTransform({ frame_id: frame, stamp: header.stamp });
		if (!abs) {
			if (frame === tf.fixed_frame)
				return { x: point.x, y: point.y, z: point.z };
			this.status.error(`Required transform frame "${frame}" not found.`);
			return null;
		}
		const r = rotateVector(abs.rotation, [point.x, point.y, point.z]);
		return { x: abs.translation.x + r[0], y: abs.translation.y + r[1], z: abs.translation.z + r[2] };
	}

	setInfo(info) {
		this.info = info;
		if (this.onInfo)
			this.onInfo(this);
	}

	setProp(key, value) {
		this.ctx.setProperty(this.id, key, value);
	}

	requestRender() {
		this.ctx.requestRender();
	}

	// ---- called by the registry and the app ----

	_safe(hook, ...args) {
		try {
			return this[hook](...args);
		} catch (e) {
			console.error(`[${this.id}] ${hook} failed:`, e);
			this.status.error(`${hook}: ${e.message}`);
			return undefined;
		}
	}

	_create(values, enabled) {
		this.props = { ...values };
		this.enabled = enabled;
		this._alive = true;
		this.ctx.frames.root.add(this.root);
		this.root.visible = enabled;

		this._safe("onCreate");

		if (typeof this.onOverlay === "function" && this.ctx.scene) {
			this._overlayFn = (ctx2d, scene) => {
				if (this.enabled)
					this._safe("onOverlay", ctx2d, scene);
			};
			this.ctx.scene.addOverlayDrawer(this._overlayFn);
		}

		this._resubscribe();
		this.requestRender();
	}

	_resubscribe() {
		if (this._unsubscribe) {
			this._unsubscribe();
			this._unsubscribe = null;
		}
		this._subscribeSeq++;
		clearTimeout(this._retryTimer);
		clearTimeout(this._noDataTimer);
		if (!("topic" in this.props) || !this._alive || !this.enabled)
			return;
		if (this.props.topic === "") {
			this.status.error("Empty topic.");
			return;
		}

		const types = this.constructor.msgTypes;
		if (types.length <= 1 || types.includes(this.props.topic_type)) {
			this._subscribeAs(this.topicType);
			return;
		}

		// several message types are accepted and this topic's is not known yet: ask
		const seq = ++this._subscribeSeq;
		const topic = this.props.topic;
		this.status.warn("Looking up the topic type...");
		this.ctx.resolveType(topic).then((type) => {
			if (seq !== this._subscribeSeq || !this._alive || !this.enabled || this.props.topic !== topic)
				return;
			if (!type) {
				// nothing publishes it yet (or rosapi did not answer): look again shortly
				this.status.warn(`Topic "${topic}" is not being published yet, so its message type is unknown. Waiting...`);
				this._retryTimer = setTimeout(() => {
					if (seq === this._subscribeSeq)
						this._resubscribe();
				}, 3000);
				return;
			}
			if (!types.includes(type)) {
				this.status.error(`Topic type ${type} is not supported by this display.`);
				return;
			}
			this.props.topic_type = type;
			this.setProp("topic_type", type); // saved, and the shells repaint
			this._subscribeAs(type);
		});
	}

	_subscribeAs(type) {
		// when only the rate changed, the data already on screen is still valid
		if (!this.lastMsg)
			this.status.warn("No data received.");
		const throttle = Number.isFinite(this.props.throttle) ? this.props.throttle : 0;
		const qos = this.props.qos ?? "auto";
		this._unsubscribe = this.ctx.subscribe(
			this.props.topic,
			type,
			throttle,
			(msg) => this._message(msg),
			qosRequest(qos)
		);
		// rosbridge matches QoS only to the publishers there are when it subscribes; with none yet it
		// picks volatile / best effort and would miss a latched map published later. Try again.
		if (qos === "auto" && !this.lastMsg) {
			const seq = this._subscribeSeq;
			this._noDataTimer = setTimeout(() => {
				if (seq === this._subscribeSeq && !this.lastMsg && this._alive && this.enabled)
					this._resubscribe();
			}, NO_DATA_RESUBSCRIBE_MS);
		}
	}

	_message(msg) {
		if (!this._alive || !this.enabled)
			return;
		this.lastMsg = msg;
		this.status.touched = false;
		this._safe("onMessage", msg);
		if (!this.status.touched)
			this.status.ok();
		this.requestRender();
	}

	_setProperty(key, value) {
		this.props[key] = value;
		if (key === "topic") {
			this.lastMsg = null;
			if ("topic_type" in this.props)
				this.props.topic_type = "";
		}
		this._safe("onPropertyChange", key, value);
		if (key === "topic" || key === "throttle" || key === "qos")
			this._resubscribe();
		this.requestRender();
	}

	_setEnabled(enabled) {
		this.enabled = enabled;
		this.root.visible = enabled;
		this._resubscribe();
		if (enabled && this._alive) {
			// hooks are skipped while disabled; catch up with what changed meanwhile
			this._safe("onTfChange");
			this._safe("onCameraChange");
		}
		this.requestRender();
	}

	_setOrder(index) {
		this.order = this.constructor.drawLayer * 100000 + index;
		this.root.traverse((object) => { object.renderOrder = this.order; });
	}

	_destroy() {
		if (this._unsubscribe) {
			this._unsubscribe();
			this._unsubscribe = null;
		}
		clearTimeout(this._retryTimer);
		clearTimeout(this._noDataTimer);
		this._subscribeSeq++;
		if (this._overlayFn) {
			this.ctx.scene.removeOverlayDrawer(this._overlayFn);
			this._overlayFn = null;
		}
		this._safe("onDestroy");
		this._alive = false;
		this.root.removeFromParent();
		this.requestRender();
	}
}
