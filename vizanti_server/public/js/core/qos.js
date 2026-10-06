// Quality of service for display subscriptions.
//
// "auto" leaves the choice to rosbridge, which matches the publishers that exist when the
// subscription is made (and falls back to volatile / best effort when there are none yet; the
// display framework re-subscribes while no data arrives, so late publishers get matched).
// The other choices are sent to rosbridge as an explicit QoS profile.

const PROFILES = {
	reliable: { reliability: "reliable", durability: "volatile", history: "keep_last", depth: 10 },
	best_effort: { reliability: "best_effort", durability: "volatile", history: "keep_last", depth: 10 },
	latched: { reliability: "reliable", durability: "transient_local", history: "keep_last", depth: 1 },
};

export const QOS_PROPERTY = {
	type: "enum",
	label: "QoS",
	default: "auto",
	options: [
		{ value: "auto", label: "Auto (match publishers)" },
		{ value: "reliable", label: "Reliable" },
		{ value: "best_effort", label: "Best effort" },
		{ value: "latched", label: "Latched (transient local)" },
	],
	help: "Auto matches what the publishers offer, and keeps trying until data arrives. "
		+ "Latched receives the last message published before you subscribed (maps, robot descriptions); "
		+ "it only works when the publisher is latched too.",
};

export function qosRequest(mode) {
	return PROFILES[mode] ? { ...PROFILES[mode] } : null;
}

// Gives a display class the QoS property when it subscribes to a topic and has none of its own.
export function withQosProperty(Cls) {
	const props = Cls.properties;
	if (!props || !("topic" in props) || "qos" in props)
		return Cls;
	Object.defineProperty(Cls, "properties", { value: { ...props, qos: QOS_PROPERTY }, writable: true, configurable: true });
	return Cls;
}

// Remembers which topics want an explicit QoS and adds it to every subscribe message sent for
// them, including the ones roslib re-sends after a reconnect.
export function createQosInjector() {
	const wanted = new Map(); // topic -> { qos, users }
	return {
		use(topic, qos) {
			if (!qos)
				return () => {};
			const entry = wanted.get(topic) ?? { qos, users: 0 };
			entry.qos = qos;
			entry.users++;
			wanted.set(topic, entry);
			let released = false;
			return () => {
				if (released)
					return;
				released = true;
				if (--entry.users <= 0 && wanted.get(topic) === entry)
					wanted.delete(topic);
			};
		},
		apply(msg) {
			if (msg && msg.op === "subscribe" && wanted.has(msg.topic))
				msg.qos = { ...wanted.get(msg.topic).qos };
			return msg;
		},
	};
}
