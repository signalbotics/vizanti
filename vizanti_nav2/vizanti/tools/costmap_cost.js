// The Costmap Cost tool (nav2_rviz_plugins/CostmapCostTool): click a point to read its cost in
// Nav2's costmaps. RViz writes the costs to its log; here they are shown as a notification (a
// browser has no log to read). Every costmap's cost service on the graph is asked, found by type,
// so a namespaced or renamed Nav2 works too; both cost services work (nav2_compat.js).
import { ToolPlugin } from '@vizanti/plugin_api.js';
import { COST_TYPES, costRequest, singleCostRequest, costText, frameFrom } from '../costmap_cost_logic.js';
import { costmapsToAsk } from '../nav2_names.js';

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

	// every cost service, with its type: [{ service, node, label, type }]
	async costmaps() {
		const found = [];
		for (const type of COST_TYPES) {
			try {
				for (const c of costmapsToAsk(await this.api.listServices(type)))
					found.push({ ...c, type });
			} catch (e) {
				// rosapi did not answer for this type
			}
		}
		return found;
	}

	async ask(point) {
		const costmaps = await this.costmaps();
		const lines = await Promise.all(costmaps.map(async (c) => {
			try {
				return costText(c.label.replace(/ costmap$/i, ""), await this.cost(c, point));
			} catch (e) {
				return null; // that costmap is not answering (RViz skips it too)
			}
		}));
		const found = lines.filter(Boolean);
		const where = `(${point.x.toFixed(2)}, ${point.y.toFixed(2)})`;
		this.api.notify(found.length ? `${found.join(" · ")} at ${where}` : `No Nav2 costmap answered for ${where}.`);
	}

	// one costmap's answer for a point in the fixed frame
	async cost(c, point) {
		if (c.type.endsWith("/GetCosts"))
			return this.api.callService(c.service, c.type, costRequest(point, this.api.header()));
		// GetCost takes the point in the costmap's own frame (odom for the local one)
		return this.api.callService(c.service, c.type, singleCostRequest(await this.inFrameOf(c.node, point)));
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
