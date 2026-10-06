import test from 'node:test';
import assert from 'node:assert/strict';
import { qosRequest, withQosProperty, QOS_PROPERTY, createQosInjector } from '../../public/js/core/qos.js';

test('qosRequest: auto leaves it to rosbridge, the others are explicit rosbridge QoS objects', () => {
	assert.equal(qosRequest("auto"), null);
	assert.equal(qosRequest(undefined), null);
	assert.deepEqual(qosRequest("reliable"), { reliability: "reliable", durability: "volatile", history: "keep_last", depth: 10 });
	assert.deepEqual(qosRequest("best_effort"), { reliability: "best_effort", durability: "volatile", history: "keep_last", depth: 10 });
	assert.deepEqual(qosRequest("latched"), { reliability: "reliable", durability: "transient_local", history: "keep_last", depth: 1 });
	assert.equal(qosRequest("nonsense"), null);
});

test('withQosProperty adds the QoS choice to displays that subscribe to a topic, once', () => {
	class Topic { static properties = { topic: { type: "topic" }, size: { type: "int", default: 1 } }; }
	class NoTopic { static properties = { size: { type: "int", default: 1 } }; }
	class Own { static properties = { topic: { type: "topic" }, qos: { type: "enum", options: ["x"], default: "x" } }; }
	withQosProperty(Topic);
	withQosProperty(Topic);
	withQosProperty(NoTopic);
	withQosProperty(Own);
	assert.deepEqual(Object.keys(Topic.properties), ["topic", "size", "qos"]);
	assert.equal(Topic.properties.qos, QOS_PROPERTY);
	assert.deepEqual(Object.keys(NoTopic.properties), ["size"]);
	assert.deepEqual(Own.properties.qos.options, ["x"]);
	// a subclass gets its own copy, so the parent is not changed through it
	class Parent { static properties = { topic: { type: "topic" } }; }
	class Child extends Parent {}
	withQosProperty(Child);
	assert.ok("qos" in Child.properties);
	assert.ok(!("qos" in Parent.properties));
});

test('the injector adds QoS to outgoing subscribe messages while a subscription wants it, including resends', () => {
	const inject = createQosInjector();
	const release = inject.use("/map", qosRequest("latched"));
	const msg = { op: "subscribe", topic: "/map", type: "nav_msgs/msg/OccupancyGrid" };
	assert.deepEqual(inject.apply(msg).qos, qosRequest("latched"));
	assert.equal(inject.apply({ op: "subscribe", topic: "/scan" }).qos, undefined);
	assert.equal(inject.apply({ op: "unsubscribe", topic: "/map" }).qos, undefined);
	// a second user of the same topic keeps it until both are gone
	const release2 = inject.use("/map", qosRequest("latched"));
	release();
	assert.ok(inject.apply({ op: "subscribe", topic: "/map" }).qos);
	release2();
	assert.equal(inject.apply({ op: "subscribe", topic: "/map" }).qos, undefined);
	// auto (null) registers nothing
	inject.use("/tf", null)();
	assert.equal(inject.apply({ op: "subscribe", topic: "/tf" }).qos, undefined);
});
