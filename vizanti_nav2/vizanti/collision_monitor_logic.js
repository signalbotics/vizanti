// The Collision Monitor display without the page: Nav2's collision_monitor zones, read from its
// parameters, and which one is acting (collision_monitor_state). Nav2 only publishes a zone's
// shape with visualize: true (off in nav2_bringup); its parameters always have it. Pure.

// nav2_msgs/msg/CollisionMonitorState action_type, and the parameter's action_type strings
export const ACTIONS = {
	0: { key: "none", label: "nothing", color: "#9aa0a6" },
	1: { key: "stop", label: "stop", color: "#ff3b30" },
	2: { key: "slowdown", label: "slow down", color: "#ff9f0a" },
	3: { key: "approach", label: "approach", color: "#ffd60a" },
	4: { key: "limit", label: "limit", color: "#5aa9ff" },
};
const BY_KEY = Object.fromEntries(Object.values(ACTIONS).map((a) => [a.key, a]));

export function actionStyle(key) {
	return BY_KEY[key] ?? { key, label: key || "?", color: "#9aa0a6" };
}

// rcl_interfaces/msg/ParameterValue -> a JS value (null: not set)
export function paramValue(value) {
	switch (value?.type) {
		case 1: return !!value.bool_value;
		case 2: return Number(value.integer_value);
		case 3: return value.double_value;
		case 4: return value.string_value;
		case 7: return [...(value.integer_array_value ?? [])].map(Number);
		case 8: return [...(value.double_array_value ?? [])];
		case 9: return [...(value.string_array_value ?? [])];
		default: return null;
	}
}

// a GetParameters response for `names` -> { name: value }
export function paramMap(names, response) {
	const values = response?.values ?? [];
	return Object.fromEntries(names.map((name, i) => [name, paramValue(values[i])]));
}

// A polygon's points parameter: "[[0.3, 0.3], [0.3, -0.3], ...]" (Iron and later) or a flat
// double array [x1, y1, x2, y2, ...] (Humble). -> [{x, y}] or null
export function parsePoints(value) {
	let flat = null;
	if (typeof value === "string") {
		const numbers = value.match(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g);
		flat = numbers ? numbers.map(Number) : null;
	} else if (Array.isArray(value)) {
		flat = value.map(Number);
	}
	if (!flat || flat.length < 6 || flat.length % 2 !== 0 || flat.some((n) => !Number.isFinite(n)))
		return null;
	const points = [];
	for (let i = 0; i < flat.length; i += 2)
		points.push({ x: flat[i], y: flat[i + 1] });
	return points;
}

export function circlePoints(radius, segments = 48) {
	return Array.from({ length: segments }, (_, i) => {
		const a = (i / segments) * 2 * Math.PI;
		return { x: radius * Math.cos(a), y: radius * Math.sin(a) };
	});
}

// the parameters to ask for each zone
export const ZONE_PARAMS = ["type", "action_type", "points", "radius", "footprint_topic", "visualize", "polygon_pub_topic", "enabled"];

// The zones from the node's parameters. top: { polygons, base_frame_id }; perZone: { "<zone>.<param>": value }
// -> [{ name, action, enabled, shape: "points" | "footprint" | "published" | "none", points, topic, frame }]
export function zonesFrom(top, perZone) {
	const frame = top.base_frame_id || "base_footprint";
	return (top.polygons ?? []).map((name) => {
		const p = (key) => perZone[`${name}.${key}`];
		const zone = { name, action: actionStyle(p("action_type")), enabled: p("enabled") !== false, frame, points: null, topic: null, shape: "none", type: p("type") ?? "polygon" };
		const points = parsePoints(p("points"));
		if (zone.type === "circle" && typeof p("radius") === "number" && p("radius") > 0) {
			zone.points = circlePoints(p("radius"));
			zone.shape = "points";
		} else if (points) {
			zone.points = points;
			zone.shape = "points";
		} else if (p("footprint_topic")) {
			zone.topic = p("footprint_topic");
			zone.shape = "footprint";
		}
		// a velocity polygon changes shape with the speed: only its published outline shows it
		if (p("visualize") === true && (zone.shape !== "points" || zone.type === "velocity_polygon")) {
			zone.topic = p("polygon_pub_topic") || name;
			zone.shape = "published";
		}
		return zone;
	});
}

// "Approach: FootprintApproach" or "Nothing"
export function stateText(msg) {
	const action = ACTIONS[msg?.action_type] ?? ACTIONS[0];
	if (action.key === "none")
		return "Nothing in any zone";
	return `${action.label[0].toUpperCase()}${action.label.slice(1)}: ${msg.polygon_name || "?"}`;
}
