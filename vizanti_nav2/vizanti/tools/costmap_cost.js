// The Costmap Cost tool (nav2_rviz_plugins/CostmapCostTool): click a point to read its cost in
// Nav2's local and global costmaps. RViz writes the costs to its log; here they are shown as a
// notification (a browser has no log to read).
import { ToolPlugin } from '@vizanti/plugin_api.js';
import { COSTMAPS, costRequest, costText } from '../costmap_cost_logic.js';

export class CostmapCostTool extends ToolPlugin {

	static key = "m";
	static hint = "Click a point to read its Nav2 costmap costs.";

	onPointer(kind, event) {
		if (kind !== "up" || event.button !== 0)
			return;
		const point = this.api.pick(event.clientX, event.clientY) ?? this.api.ground(event.clientX, event.clientY);
		if (!point) {
			this.api.notify("Move over an object to select the target point.");
			return;
		}
		this.ask(point);
		this.api.done(); // "Single click": back to Move Camera after one point, as RViz does by default
	}

	async ask(point) {
		const request = costRequest(point, this.api.header());
		const lines = await Promise.all(COSTMAPS.map(async ([label, service]) => {
			try {
				return costText(label, await this.api.callService(service, "nav2_msgs/srv/GetCosts", request));
			} catch (e) {
				return null; // that costmap is not running (RViz skips it too)
			}
		}));
		const found = lines.filter(Boolean);
		const where = `(${point.x.toFixed(2)}, ${point.y.toFixed(2)})`;
		this.api.notify(found.length ? `${found.join(" · ")} at ${where}` : `No Nav2 costmap answered for ${where}.`);
	}
}
