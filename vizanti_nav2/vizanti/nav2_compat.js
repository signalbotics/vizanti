// Nav2's interfaces differ between releases, and one Vizanti serves them all. What the robot
// runs is asked of the robot (rosapi), not assumed from Vizanti's own build:
//
// | | Humble, Jazzy | Kilted and later (Lyrical) |
// |---|---|---|
// | NavigateThroughPoses goal `poses` | `geometry_msgs/PoseStamped[]` | `nav_msgs/Goals` (header + goals) |
// | costmap cost service | `GetCost`: one x, y, theta | `GetCosts`: a list of stamped poses |
// | lifecycle managers | `lifecycle_manager_navigation`, `lifecycle_manager_localization` | also `lifecycle_manager_nav2` |
// | Selector's Path Handler | none (`path_handler_plugins` unset) | yes |

// distros whose nav2_msgs have the older forms above, for a rosapi that cannot describe an action
const OLD_NAV2 = new Set(["humble", "iron", "jazzy"]);

const askedOnce = new WeakMap(); // ctx -> { [key]: Promise }

function once(ctx, key, fn) {
	let cache = askedOnce.get(ctx);
	if (!cache)
		askedOnce.set(ctx, cache = {});
	if (!cache[key])
		cache[key] = fn().catch((e) => {
			delete cache[key]; // ask again next time; rosbridge may not have been up
			throw e;
		});
	return cache[key];
}

// rosapi's TypeDef list for an action goal -> is `poses` a plain array? null: not described
export function posesIsArray(typedefs) {
	const goal = typedefs?.find((t) => /NavigateThroughPoses_Goal$/.test(t.type));
	const i = goal?.fieldnames?.indexOf("poses") ?? -1;
	if (i < 0)
		return null;
	return goal.fieldarraylen[i] >= 0;
}

async function rosDistro(ctx) {
	const response = await ctx.callService("/rosapi/get_ros_version", "rosapi_msgs/srv/GetROSVersion", {}, 3000);
	return String(response?.distro ?? "").toLowerCase();
}

// true when this robot's NavigateThroughPoses takes poses: PoseStamped[] (Humble, Jazzy)
export function ntpPosesIsArray(ctx) {
	return once(ctx, "ntp", async () => {
		try {
			const response = await ctx.callService("/rosapi/action_goal_details", "rosapi_msgs/srv/ActionGoalDetails",
				{ type: "nav2_msgs/action/NavigateThroughPoses" }, 3000);
			const answer = posesIsArray(response?.typedefs);
			if (answer !== null)
				return answer;
		} catch (e) {
			// an older rosapi without action_goal_details: go by the distro
		}
		return OLD_NAV2.has(await rosDistro(ctx));
	});
}

// The NavigateThroughPoses goal for either form. poses: PoseStamped messages, all in one frame.
export function ntpGoal(poses, frame, stamp, behaviorTree, posesIsArray) {
	return {
		poses: posesIsArray ? poses : { header: { frame_id: frame, stamp }, goals: poses },
		behavior_tree: behaviorTree,
	};
}

// the costmap cost service's type: "nav2_msgs/srv/GetCost" (one point) or ".../GetCosts"
export async function costServiceType(ctx, service) {
	const response = await ctx.callService("/rosapi/service_type", "rosapi_msgs/srv/ServiceType", { service }, 3000);
	return response?.type || null;
}

// Which lifecycle managers the Navigation 2 panel talks to. configured: the panel's setting, empty
// for automatic; available: the node names that offer manage_nodes. The first one is the one whose
// state is "Navigation:"; commands go to all of them, as the Jazzy panel sends them to both.
export function managersFrom(configured, available) {
	const has = (name) => available.includes(name);
	const name = String(configured ?? "").replace(/^\//, "");
	if (name && has(name))
		return [name];
	if (has("lifecycle_manager_nav2"))
		return ["lifecycle_manager_nav2"];
	const split = ["lifecycle_manager_navigation", "lifecycle_manager_localization"].filter(has);
	if (split.length > 0 && (name === "" || name === "lifecycle_manager_nav2"))
		return split;
	return [name || "lifecycle_manager_nav2"]; // nothing found yet: keep asking for the setting
}

// "/lifecycle_manager_navigation/manage_nodes" -> "lifecycle_manager_navigation"
export function managerNodes(services) {
	return services.map((s) => s.match(/^\/?(.*)\/manage_nodes$/)?.[1]).filter(Boolean);
}
