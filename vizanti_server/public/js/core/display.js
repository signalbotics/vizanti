import * as THREE from '../lib/three.module.min.js';

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
export class Display {

	static kind = "display";
	static type = "";
	static label = "";
	static icon = "";
	static description = "";
	static msgTypes = [];
	static properties = {};

	static propsForTopic(topic) {
		return { topic };
	}

	constructor(id, ctx) {
		this.id = id;
		this.ctx = ctx;
		this.name = this.constructor.label;
		this.props = {};
		this.enabled = true;
		this.info = {};
		this.order = 0;
		this.lastMsg = null;
		this.status = new DisplayStatus();
		this.onInfo = null;

		this.root = new THREE.Group();
		this.root.name = id;

		this._alive = false;
		this._unsubscribe = null;
		this._overlayFn = null;
	}

	get icon() {
		return this.constructor.icon;
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
		if (!("topic" in this.props) || !this._alive || !this.enabled)
			return;
		if (this.props.topic === "") {
			this.status.error("Empty topic.");
			return;
		}
		this.status.warn("No data received.");
		const throttle = Number.isFinite(this.props.throttle) ? this.props.throttle : 0;
		this._unsubscribe = this.ctx.subscribe(
			this.props.topic,
			this.constructor.msgTypes[0],
			throttle,
			(msg) => this._message(msg)
		);
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
		if (key === "topic")
			this.lastMsg = null;
		this._safe("onPropertyChange", key, value);
		if (key === "topic" || key === "throttle")
			this._resubscribe();
		this.requestRender();
	}

	_setEnabled(enabled) {
		this.enabled = enabled;
		this.root.visible = enabled;
		this._resubscribe();
		this.requestRender();
	}

	_setOrder(index) {
		this.order = index;
		this.root.traverse((object) => { object.renderOrder = index; });
	}

	_destroy() {
		if (this._unsubscribe) {
			this._unsubscribe();
			this._unsubscribe = null;
		}
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
