// Route Tool's Route tab without the page: ask Nav2's route server for a route over the graph it
// has loaded (ComputeRoute), and drive it with NavigateThroughPoses through the route's nodes.
// The route's own path is not handed to the controller (FollowPath): it starts at the first node,
// wherever the robot is, and the controller does not get there by itself. Through the nodes,
// Nav2's planner brings the robot onto the route, with its usual recoveries. Both actions exist on
// Humble / Jazzy and later; Lyrical's route behaviour tree is not in Jazzy. Pure.

export const COMPUTE_ROUTE = { action: "/compute_route", type: "nav2_msgs/action/ComputeRoute" };
export const NAVIGATE_THROUGH = { action: "/navigate_through_poses", type: "nav2_msgs/action/NavigateThroughPoses" };
export const PATH_TOPIC = "/route_tool/path";

// "12" -> 12; node ids are uint16
export function nodeId(text) {
	const t = String(text ?? "").trim();
	if (!/^\d+$/.test(t))
		return null;
	const n = Number(t);
	return n <= 65535 ? n : null;
}

// The ComputeRoute goal. request: { mode: "ids", start, goal } or { mode: "point", x, y }, the
// point in `frame`; from a point, the start is the robot (the route server looks it up in TF).
export function routeGoal(request, frame = "map", stamp = { sec: 0, nanosec: 0 }) {
	const pose = (x, y) => ({ header: { frame_id: frame, stamp }, pose: { position: { x, y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } });
	if (request.mode === "ids") {
		const start = nodeId(request.start);
		const goal = nodeId(request.goal);
		if (start === null || goal === null)
			return { error: "Start and goal are node ids (whole numbers) of the route server's graph." };
		if (start === goal)
			return { error: "Start and goal are the same node." };
		return { goal: { start_id: start, goal_id: goal, use_start: false, use_poses: false } };
	}
	const x = Number(request.x);
	const y = Number(request.y);
	if (String(request.x ?? "").trim() === "" || String(request.y ?? "").trim() === "" || !Number.isFinite(x) || !Number.isFinite(y))
		return { error: "The goal needs an X and a Y (Publish Point fills them)." };
	return { goal: { start: pose(0, 0), goal: pose(x, y), use_start: false, use_poses: true } };
}

export function pathLength(path) {
	const poses = path?.poses ?? [];
	let length = 0;
	for (let i = 1; i < poses.length; i++) {
		const a = poses[i - 1].pose.position;
		const b = poses[i].pose.position;
		length += Math.hypot(b.x - a.x, b.y - a.y);
	}
	return length;
}

// "Route 4 → 7 → 8: cost 3.72, 2.84 m"
export function routeSummary(result) {
	const nodes = (result?.route?.nodes ?? []).map((n) => n.nodeid);
	const shown = nodes.length > 8 ? [...nodes.slice(0, 3), "…", ...nodes.slice(-3)] : nodes;
	const cost = result?.route?.route_cost;
	return `Route ${shown.join(" → ")}: cost ${typeof cost === "number" ? cost.toFixed(2) : "?"}, ${pathLength(result?.path).toFixed(2)} m`;
}

const ROUTE_ERRORS = {
	1: "the route server rejected the request",
	2: "the request could not be sent",
	400: "unknown error",
	401: "the robot or the goal could not be found in TF",
	402: "the route server has no valid graph loaded",
	403: "the start or goal is not near any node of the graph",
	404: "the route server ran out of time",
	405: "the graph has no route between them (edges may be blocked by obstacles in the costmap)",
	407: "an edge scorer is misconfigured",
};

// The route server's own words are kept, but some are C++ internals: "unordered_map::at" is what
// Nav2 says about a node id that is not in its graph.
// byIds: the request named node ids. Jazzy's result has no error_msg, so a missing id is only
// "unknown error" there.
export function routeErrorText(values, byIds = false) {
	const message = values?.error_msg ?? "";
	if (/unordered_map::at|out of range/i.test(message))
		return "a node id is not in the route server's graph";
	if (byIds && values?.error_code === 400 && !message)
		return "unknown error (is each node id in the route server's graph?)";
	return ROUTE_ERRORS[values?.error_code] ?? (message || `error ${values?.error_code ?? "?"}`);
}

// The route's nodes as poses to drive through, each facing the next node (the last one keeps the
// heading of the last edge). PoseStamped messages, in the route's frame.
export function routeWaypoints(route, stamp = { sec: 0, nanosec: 0 }) {
	const frame = route?.header?.frame_id || "map";
	const nodes = route?.nodes ?? [];
	let yaw = 0;
	return nodes.map((node, i) => {
		const here = node.position;
		const next = nodes[i + 1]?.position;
		const before = nodes[i - 1]?.position;
		if (next)
			yaw = Math.atan2(next.y - here.y, next.x - here.x);
		else if (before)
			yaw = Math.atan2(here.y - before.y, here.x - before.x);
		return {
			header: { frame_id: frame, stamp },
			pose: { position: { x: here.x, y: here.y, z: 0 }, orientation: { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) } },
		};
	});
}

// NavigateThroughPoses feedback: "1.42 m to go, 2 nodes left"
export function driveFeedbackText(fb) {
	if (!fb)
		return "";
	const distance = typeof fb.distance_remaining === "number" ? `${fb.distance_remaining.toFixed(2)} m to go` : "";
	const left = typeof fb.number_of_poses_remaining === "number" ? `${fb.number_of_poses_remaining} node${fb.number_of_poses_remaining === 1 ? "" : "s"} left` : "";
	return [distance, left].filter(Boolean).join(", ");
}

export function driveErrorText(values) {
	return values?.error_msg || (values?.error_code ? `error ${values.error_code}` : "Nav2 gave no reason");
}
