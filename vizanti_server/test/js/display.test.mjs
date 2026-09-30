import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../public/js/lib/three.module.min.js';
import { Display, DisplayStatus } from '../../public/js/core/display.js';
import { FrameNodes } from '../../public/js/core/frames.js';

function makeCtx() {
	const tf = {
		fixed_frame: "odom",
		absoluteTransforms: {
			base_link: { translation: { x: 1, y: 2, z: 3 }, rotation: { w: 1, x: 0, y: 0, z: 0 } },
		},
		getAbsoluteTransform(header) { return this.absoluteTransforms[header.frame_id]; },
	};
	const subs = [];
	const sets = [];
	const ctx = {
		tf,
		frames: new FrameNodes(tf),
		renders: 0,
		requestRender() { this.renders++; },
		subscribe(topic, type, throttle, cb) {
			const s = { topic, type, throttle, cb, active: true };
			subs.push(s);
			return () => { s.active = false; };
		},
		setProperty(id, key, value) { sets.push([id, key, value]); },
	};
	return { ctx, subs, sets, tf };
}

class Probe extends Display {
	static type = "probe";
	static label = "Probe";
	static icon = "assets/probe.svg";
	static msgTypes = ["std_msgs/msg/String"];
	static properties = {
		topic: { type: "topic" },
		throttle: { type: "int", default: 100 },
		color: { type: "color", default: "#ff0000" },
	};
	onCreate() { this.created = true; }
	onMessage(msg) {
		if (msg.boom) throw new Error("kaboom");
		if (msg.warn) this.status.warn("odd data");
		this.seen = msg;
	}
	onPropertyChange(key, value) { this.changed = [key, value]; }
	onDestroy() { this.destroyed = true; }
}

function start(props = {}, enabled = true) {
	const env = makeCtx();
	const d = new Probe("probe_0", env.ctx);
	d._create({ topic: "/chat", throttle: 100, color: "#ff0000", ...props }, enabled);
	return { d, ...env };
}

test('DisplayStatus reports changes once and tracks that it was touched', () => {
	const s = new DisplayStatus();
	let n = 0;
	s.onChange = () => n++;
	s.warn("a");
	s.warn("a");
	s.error("b");
	s.ok();
	assert.equal(n, 3);
	assert.deepEqual([s.level, s.text, s.touched], ["ok", "Ok", true]);
});

test('create attaches the root, runs onCreate and subscribes', () => {
	const { d, subs, ctx } = start();
	assert.equal(d.created, true);
	assert.equal(d.root.parent, ctx.frames.root);
	assert.deepEqual([subs[0].topic, subs[0].type, subs[0].throttle], ["/chat", "std_msgs/msg/String", 100]);
	assert.deepEqual([d.status.level, d.status.text], ["warn", "No data received."]);
	assert.equal(d.icon, "assets/probe.svg");
});

test('an empty topic is an error and nothing is subscribed', () => {
	const { d, subs } = start({ topic: "" });
	assert.equal(subs.length, 0);
	assert.deepEqual([d.status.level, d.status.text], ["error", "Empty topic."]);
});

test('a message sets the status to ok unless the display said otherwise', () => {
	const { d, subs } = start();
	subs[0].cb({ data: "hi" });
	assert.deepEqual(d.seen, { data: "hi" });
	assert.equal(d.lastMsg, d.seen);
	assert.equal(d.status.level, "ok");
	subs[0].cb({ warn: true });
	assert.deepEqual([d.status.level, d.status.text], ["warn", "odd data"]);
});

test('a throwing hook becomes an error status and does not propagate', () => {
	const { d, subs } = start();
	assert.doesNotThrow(() => subs[0].cb({ boom: true }));
	assert.deepEqual([d.status.level, d.status.text], ["error", "onMessage: kaboom"]);
});

test('changing the topic or throttle resubscribes; other properties do not', () => {
	const { d, subs } = start();
	d._setProperty("color", "#00ff00");
	assert.equal(subs.length, 1);
	assert.deepEqual(d.changed, ["color", "#00ff00"]);
	d._setProperty("topic", "/other");
	assert.equal(subs[0].active, false);
	assert.equal(subs[1].topic, "/other");
	assert.equal(d.lastMsg, null);
	d._setProperty("throttle", 500);
	assert.equal(subs[1].active, false);
	assert.equal(subs[2].throttle, 500);
});

test('disabling hides the root and unsubscribes; enabling restores both', () => {
	const { d, subs } = start();
	d._setEnabled(false);
	assert.equal(d.root.visible, false);
	assert.equal(subs[0].active, false);
	subs[0].cb({ data: "late" });
	assert.equal(d.seen, undefined);
	d._setEnabled(true);
	assert.equal(d.root.visible, true);
	assert.equal(subs.length, 2);
});

test('a display created disabled does not subscribe', () => {
	const { d, subs } = start({}, false);
	assert.equal(subs.length, 0);
	assert.equal(d.root.visible, false);
});

test('destroy unsubscribes, runs onDestroy and detaches the root', () => {
	const { d, subs } = start();
	d._destroy();
	assert.equal(subs[0].active, false);
	assert.equal(d.destroyed, true);
	assert.equal(d.root.parent, null);
});

test('setFrame snapshots the stamped transform by default', () => {
	const { d, ctx } = start();
	assert.equal(d.setFrame({ frame_id: "base_link" }), true);
	assert.equal(d.root.parent, ctx.frames.root);
	assert.deepEqual(d.root.position.toArray(), [1, 2, 3]);
});

test('setFrame with follow parents the root to the live frame node', () => {
	const { d, ctx } = start();
	assert.equal(d.setFrame({ frame_id: "base_link" }, { follow: true }), true);
	assert.equal(d.root.parent, ctx.frames.get("base_link"));
	assert.deepEqual(d.root.position.toArray(), [0, 0, 0]);
});

test('setFrame reports a missing transform and returns false', () => {
	const { d } = start();
	assert.equal(d.setFrame({ frame_id: "camera" }), false);
	assert.deepEqual([d.status.level, d.status.text], ["error", 'Required transform frame "camera" not found.']);
	assert.equal(d.setFrame({ frame_id: "camera" }, { follow: true }), false);
});

test('setFrame falls back to the fixed frame for an empty frame id, with a warning', () => {
	const { d } = start();
	assert.equal(d.setFrame({ frame_id: "" }), true);
	assert.deepEqual(d.root.position.toArray(), [0, 0, 0]);
	assert.equal(d.status.level, "warn");
	assert.match(d.status.text, /empty string/);
});

test('add applies the display order to new objects, and _setOrder to existing ones', () => {
	const { d } = start();
	d._setOrder(4);
	const a = new THREE.Group();
	d.add(a);
	assert.equal(a.parent, d.root);
	assert.equal(a.renderOrder, 4);
	d._setOrder(7);
	assert.equal(a.renderOrder, 7);
});

test('setInfo notifies and setProp routes through the context', () => {
	const { d, sets } = start();
	let n = 0;
	d.onInfo = () => n++;
	d.setInfo({ Points: 5 });
	assert.deepEqual(d.info, { Points: 5 });
	assert.equal(n, 1);
	d.setProp("color", "#0000ff");
	assert.deepEqual(sets, [["probe_0", "color", "#0000ff"]]);
});

test('propsForTopic defaults to the topic property', () => {
	assert.deepEqual(Probe.propsForTopic("/a"), { topic: "/a" });
});
