// The Costmap Cost tool (nav2_rviz_plugins/CostmapCostTool): click a point to read its cost in
// Nav2's local and global costmaps. RViz writes the costs to its log; here they are shown as a
// notification (a browser has no log to read). Works with both cost services (nav2_compat.js).
import { ToolPlugin } from '@vizanti/plugin_api.js';
import { COSTMAPS, costRequest, singleCostRequest, costText, frameFrom } from '../costmap_cost_logic.js';
import { costServiceType } from '../nav2_compat.js';

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
		const lines = await Promise.all(COSTMAPS.map(async ([label, service, node]) => {
			try {
				return costText(label, await this.cost(service, node, point));
			} catch (e) {
				return null; // that costmap is not running (RViz skips it too)
			}
		}));
		const found = lines.filter(Boolean);
		const where = `(${point.x.toFixed(2)}, ${point.y.toFixed(2)})`;
		this.api.notify(found.length ? `${found.join(" · ")} at ${where}` : `No Nav2 costmap answered for ${where}.`);
	}

	// one costmap's answer for a point in the fixed frame
	async cost(service, node, point) {
		this.types ??= {};
		this.types[service] ??= await costServiceType(this.api, service);
		const type = this.types[service];
		if (!type)
			throw new Error(`${service} is not running`);
		if (type.endsWith("/GetCosts"))
			return this.api.callService(service, type, costRequest(point, this.api.header()));
		// GetCost takes the point in the costmap's own frame (odom for the local one)
		return this.api.callService(service, type, singleCostRequest(await this.inFrameOf(node, point)));
	}

	async inFrameOf(node, point) {
		this.frames ??= {};
		if (!(node in this.frames)) {
			try {
				this.frames[node] = frameFrom(await this.api.callService(`${node}/get_parameters`, "rcl_interfaces/srv/GetParameters", { names: ["global_frame"] }));
			} catch (e) {
				this.frames[node] = null;
			}
		}
		const frame = this.frames[node];
		const fixed = this.api.fixedFrame();
		if (!frame || frame === fixed || !this.api.tf.absoluteTransforms?.[frame])
			return point;
		return this.api.tf.transformPose(fixed, frame, { x: point.x, y: point.y, z: point.z ?? 0 }, new Quaternion()).translation;
	}
}
