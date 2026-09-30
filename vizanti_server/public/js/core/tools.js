// The built-in pointer tools of the 3D view, as in RViz. This module has no DOM or WebGL
// in it: the app hands it pointer events and the few scene operations it needs.

export const TOOLS = [
	{ id: "move", label: "Move Camera", key: "m", hint: "Drag to move the camera." },
	{ id: "select", label: "Select", key: "s", hint: "Click something in the view to see what it is." },
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
		this.selection = null;   // { point, lines } from the select tool
		this.onChange = null;
		this.onOptions = null;
		this._dragStart = null;
	}

	select(id) {
		if (!TOOLS.some((tool) => tool.id === id) || id === this.active)
			return;
		this.active = id;
		this.preview = null;
		this.measurement = null;
		this.selection = null;
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
				// stays armed like RViz's select tool; a click on nothing clears the selection
				if (kind === "up")
					this.selection = this.deps.inspect(event.clientX, event.clientY);
				break;
		}
		this.deps.requestRender();
	}

	clickTool(event) {
		const point = this.deps.pick(event.clientX, event.clientY);
		if (!point)
			return; // nothing there; stay armed
		if (this.active === "point") {
			this.deps.publish(this.options.point_topic, "geometry_msgs/msg/PointStamped", {
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
			this.deps.publish(this.options.goal_topic, "geometry_msgs/msg/PoseStamped", { header: this.header(), pose });
		} else {
			this.deps.publish(this.options.estimate_topic, "geometry_msgs/msg/PoseWithCovarianceStamped", {
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
