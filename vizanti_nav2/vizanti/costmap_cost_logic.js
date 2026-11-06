// The Costmap Cost tool (nav2_rviz_plugins/CostmapCostTool) without the page. Pure.

// The costmaps asked are every cost service on the graph, under any name or namespace
// (nav2_names.js costmapsToAsk): RViz asks just /local_costmap and /global_costmap.
export const COST_TYPES = ["nav2_msgs/srv/GetCosts", "nav2_msgs/srv/GetCost"];

// Kilted and later: nav2_msgs/srv/GetCosts, stamped poses, one point here (use_footprint off, as
// in RViz). The stamp is 0, "the latest transform": the browser's clock is not the robot's
// (simulation time, clock skew), and a point stamped ahead of the costmap's TF fails with
// success: false.
export function costRequest(point, header) {
	return {
		use_footprint: false,
		poses: [{ header: { ...header, stamp: { sec: 0, nanosec: 0 } }, pose: { position: { x: point.x, y: point.y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }],
	};
}

// Humble and Jazzy: nav2_msgs/srv/GetCost, one x, y already in the costmap's own frame
export function singleCostRequest(point) {
	return { use_footprint: false, x: point.x, y: point.y, theta: 0 };
}

// "Local costmap cost: 253.0" (RViz logs the same line), from either response. A point outside
// the costmap, or one that could not be transformed into it, reads "no cost here": GetCosts says
// success: false, GetCost answers -1 (RViz prints both numbers as they are).
export function costText(label, response) {
	const cost = Array.isArray(response?.costs) ? response.costs[0] : response?.cost;
	if (typeof cost !== "number")
		return null;
	if (response.success === false || cost < 0)
		return `${label} costmap: no cost here`;
	return `${label} costmap cost: ${cost.toFixed(1)}`;
}

// rcl_interfaces/srv/GetParameters response for ["global_frame"] -> the frame, or null
export function frameFrom(response) {
	const value = response?.values?.[0];
	return value?.type === 4 && value.string_value ? value.string_value : null; // 4: PARAMETER_STRING
}
