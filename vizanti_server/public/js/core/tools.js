import { normalizeRect, combineSelections } from '../geometry/selection.js';

// The built-in pointer tools of the 3D view, as in RViz. This module has no DOM or WebGL
// in it: the app hands it pointer events and the few scene operations it needs.

export const TOOLS = [
	{ id: "move", label: "Move Camera", key: "m", hint: "Drag to move the camera." },
	{ id: "select", label: "Select", key: "s", hint: "Click something to see what it is, or drag a box around points and objects (Shift adds)." },
	{ id: "measure", label: "Measure", key: "n", hint: "Click two points to measure the distance between them." },
	{ id: "point", label: "Publish Point", key: "c", hint: "Click a point to publish it." },
	{ id: "focus", label: "Focus Camera", key: "f", hint: "Click a point to centre the camera on it." },
	{ id: "goal", label: "2D Goal Pose", key: "g", hint: "Press where the robot should go and drag to set its heading." },
	{ id: "estimate", label: "2D Pose Estimate", key: "p", hint: "Press where the robot is and drag to set its heading." },
];

export const DEFAULT_TOOL_OPTIONS = {
	point_topic: "/clicked_point",
	goal_topic: "/goal_pose",
	estimate_topic: "/initialpose",
};

// x, y and yaw variances RViz uses for an initial pose
const ESTIMATE_COVARIANCE = (() => {
	const c = new Array(36).fill(0);
	c[0] = 0.25;
	c[7] = 0.25;
	c[35] = 0.06853892326654787;
	return c;
})();

export function yawQuaternion(yaw) {
	return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

export function stampNow(milliseconds) {
	return { sec: Math.floor(milliseconds / 1000), nanosec: (milliseconds % 1000) * 1e6 };
}

function sanitizeTopics(topics) {
	if (topics === null || typeof topics !== "object")
		return null;
	const out = {};
	for (const key of Object.keys(DEFAULT_TOOL_OPTIONS)) {
		if (typeof topics[key] === "string" && topics[key].trim() !== "")
			out[key] = topics[key].trim();
	}
	return out;
}

// the topic a tool publishes to now: a one-off override, else the configured one
export function toolTopic(manager, key) {
	return manager.topics?.[key] ?? manager.options[key];
}

export function sanitizeToolOptions(options) {
	const out = { ...DEFAULT_TOOL_OPTIONS };
	if (options !== null && typeof options === "object") {
		for (const key of Object.keys(DEFAULT_TOOL_OPTIONS)) {
			if (typeof options[key] === "string" && options[key].trim() !== "")
				out[key] = options[key].trim();
		}
	}
	return out;
}

// deps:
//   pick(clientX, clientY)   -> nearest point under the pointer on an object or the ground, or null
//   ground(clientX, clientY) -> point on the ground plane under the pointer, or null
//   inspect(clientX, clientY) -> { point, lines } describing the object under the pointer, or null
//   focus(point), setInputEnabled(bool), publish(topic, type, msg), fixedFrame(), now(), requestRender()
export class ToolManager {

	constructor(deps, options) {
		this.deps = deps;
		this.options = sanitizeToolOptions(options);
		this.active = "move";
		this.preview = null;     // { start, yaw } while a pose is being dragged out
		this.measurement = null; // { a, b, distance, done }
		this.selection = null;   // { point, lines } from a click, or { entries } from a box
		this.selectBox = null;   // the box being dragged out, in client px
		this.onSelection = null;
		this.onChange = null;
		this.onOptions = null;
		this._dragStart = null;
	}

	// topics: one-off topic overrides for this use of the tool ({ goal_topic: "/robot2/goal" }),
	// as a widget's own Nav Goal or Pose Estimate button sets them
	select(id, topics = null) {
		if (!TOOLS.some((tool) => tool.id === id))
			return;
		this.topics = id === "move" ? null : sanitizeTopics(topics);
		if (id === this.active)
			return;
		this.active = id;
		this.preview = null;
		this.measurement = null;
		if (this.selection && this.onSelection)
			this.onSelection(null);
		this.selection = null;
		this.selectBox = null;
		this._boxStart = null;
		this._dragStart = null;
		this.deps.setInputEnabled(id === "move");
		this.deps.requestRender();
		if (this.onChange)
			this.onChange(id);
	}

	setOption(key, value) {
		this.options = sanitizeToolOptions({ ...this.options, [key]: value });
		if (this.onOptions)
			this.onOptions(this.options);
	}

	key(key) {
		if (key === "Escape") {
			this.select("move");
			return;
		}
		const tool = TOOLS.find((t) => t.key === key);
		if (tool)
			this.select(tool.id);
	}

	header() {
		return { frame_id: this.deps.fixedFrame(), stamp: stampNow(this.deps.now()) };
	}

	// kind: "down" | "move" | "up"; event: { clientX, clientY, button }
	pointer(kind, event) {
		if (this.active === "move")
			return;
		if (kind !== "move" && event.button !== 0)
			return;

		switch (this.active) {
			case "point":
			case "focus":
				if (kind === "up")
					this.clickTool(event);
				break;
			case "goal":
			case "estimate":
				this.poseTool(kind, event);
				break;
			case "measure":
				this.measureTool(kind, event);
				break;
			case "select":
				this.selectTool(kind, event);
				break;
		}
		this.deps.requestRender();
	}

	// Stays armed like RViz's select tool. A click shows what is under it (a click on nothing
	// clears the selection); a drag selects everything in the box, and Shift adds to it.
	selectTool(kind, event) {
		if (kind === "down") {
			this._boxStart = { x: event.clientX, y: event.clientY };
			this.selectBox = null;
			return;
		}
		const start = this._boxStart;
		if (!start)
			return;
		const dragged = Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4;
		if (kind === "move") {
			this.selectBox = dragged ? normalizeRect(start.x, start.y, event.clientX, event.clientY) : null;
			return;
		}
		this._boxStart = null;
		if (dragged) {
			const box = normalizeRect(start.x, start.y, event.clientX, event.clientY);
			const found = this.deps.boxSelect?.(box) ?? new Map();
			this.selection = { entries: combineSelections(this.selection?.entries ?? null, found, !!event.shiftKey) };
		} else {
			this.selection = this.deps.inspect(event.clientX, event.clientY);
		}
		this.selectBox = null;
		if (this.onSelection)
			this.onSelection(this.selection);
	}

	clearSelection() {
		this.selection = null;
		this.deps.requestRender();
		if (this.onSelection)
			this.onSelection(null);
	}

	clickTool(event) {
		const point = this.deps.pick(event.clientX, event.clientY);
		if (!point)
			return; // nothing there; stay armed
		if (this.active === "point") {
			this.deps.publish(toolTopic(this, "point_topic"), "geometry_msgs/msg/PointStamped", {
				header: this.header(),
				point: { x: point.x, y: point.y, z: point.z },
			});
		} else {
			this.deps.focus({ x: point.x, y: point.y, z: point.z });
		}
		this.select("move");
	}

	poseTool(kind, event) {
		const here = this.deps.ground(event.clientX, event.clientY);
		if (kind === "down") {
			if (here) {
				this._dragStart = here;
				this.preview = { start: here, yaw: 0 };
			}
			return;
		}
		if (!this._dragStart)
			return;

		const start = this._dragStart;
		let yaw = this.preview.yaw;
		if (here && (here.x !== start.x || here.y !== start.y))
			yaw = Math.atan2(here.y - start.y, here.x - start.x);
		this.preview = { start, yaw };
		if (kind !== "up")
			return;

		const pose = { position: { x: start.x, y: start.y, z: 0 }, orientation: yawQuaternion(yaw) };
		if (this.active === "goal") {
			this.deps.publish(toolTopic(this, "goal_topic"), "geometry_msgs/msg/PoseStamped", { header: this.header(), pose });
		} else {
			this.deps.publish(toolTopic(this, "estimate_topic"), "geometry_msgs/msg/PoseWithCovarianceStamped", {
				header: this.header(),
				pose: { pose, covariance: [...ESTIMATE_COVARIANCE] },
			});
		}
		this.select("move");
	}

	measureTool(kind, event) {
		if (kind === "down")
			return;
		const point = this.deps.pick(event.clientX, event.clientY);
		if (!point)
			return;
		const m = this.measurement;
		if (kind === "move") {
			if (m && !m.done) {
				m.b = point;
				m.distance = Math.hypot(point.x - m.a.x, point.y - m.a.y, point.z - m.a.z);
			}
			return;
		}
		// a click: first point, second point, or start over
		if (!m || m.done) {
			this.measurement = { a: point, b: point, distance: 0, done: false };
		} else {
			m.b = point;
			m.distance = Math.hypot(point.x - m.a.x, point.y - m.a.y, point.z - m.a.z);
			m.done = true;
		}
	}
}
