// The Costmap Cost tool (nav2_rviz_plugins/CostmapCostTool) without the page. Pure.

// the costmaps asked, as RViz asks them: [label, service]
export const COSTMAPS = [
	["Local", "/local_costmap/get_cost_local_costmap"],
	["Global", "/global_costmap/get_cost_global_costmap"],
];

// nav2_msgs/srv/GetCosts request for one point (use_footprint off, as in RViz). The stamp is 0,
// "the latest transform": the browser's clock is not the robot's (simulation time, clock skew),
// and a point stamped ahead of the costmap's TF fails with success: false.
export function costRequest(point, header) {
	return {
		use_footprint: false,
		poses: [{ header: { ...header, stamp: { sec: 0, nanosec: 0 } }, pose: { position: { x: point.x, y: point.y, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } }],
	};
}

// "Local costmap cost: 253.0" (RViz logs the same line). success false: the point is outside that
// costmap or could not be transformed into it (RViz prints the meaningless cost anyway).
export function costText(label, response) {
	const cost = response?.costs?.[0];
	if (typeof cost !== "number")
		return null;
	if (response.success === false)
		return `${label} costmap: no cost here`;
	return `${label} costmap cost: ${cost.toFixed(1)}`;
}
