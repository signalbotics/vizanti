// Nav2's names, without hardcoding them to one robot. Nav2 launched with a namespace
// (nav2_bringup namespace:=robot1) puts every node, action, service and topic under it:
// /robot1/spin, /robot1/local_costmap/... The panels take a "Nav2 namespace" setting and put it
// in front of each name; costmaps are found by their service type, under any name. Pure.

export const NAMESPACE_PROPERTY = {
	type: "string", label: "Nav2 namespace", default: "",
	help: "The namespace Nav2 runs in (nav2_bringup namespace:=robot1 → robot1). Empty: none. Every Nav2 action, service and topic this uses is looked up under it.",
};

// "robot1", "/robot1/", " " -> "/robot1" or ""
export function normalizeNamespace(ns) {
	const t = String(ns ?? "").trim().replace(/^\/+|\/+$/g, "");
	return t ? `/${t}` : "";
}

// a Nav2 name in the namespace: ("robot1", "/spin") -> "/robot1/spin"; absolute names that
// already carry the namespace are left alone
export function inNamespace(ns, name) {
	const prefix = normalizeNamespace(ns);
	const clean = `/${String(name).replace(/^\/+/, "")}`;
	if (!prefix || clean === prefix || clean.startsWith(`${prefix}/`))
		return clean;
	return `${prefix}${clean}`;
}

// the services of a type that are in the namespace (all of them with no namespace set)
export function servicesIn(ns, services) {
	const prefix = normalizeNamespace(ns);
	return services.filter((s) => !prefix || s.startsWith(`${prefix}/`)).sort();
}

const words = (name) => name.replace(/_/g, " ");

// "/robot1/local_costmap/clear_entirely_local_costmap" in "robot1"
//   -> { service, costmap: "local_costmap", label: "Local costmap" }
// The label is the costmap's node name; outside the namespace (none set, several robots) it
// keeps the namespace so two robots' costmaps are told apart.
export function costmapService(ns, service, prefixPattern) {
	const base = service.split("/").pop();
	const costmap = base.replace(prefixPattern, "");
	const where = service.slice(0, service.length - base.length - 1); // "/robot1/local_costmap"
	const relative = where.slice(normalizeNamespace(ns).length).replace(/^\//, "");
	const text = words(relative.endsWith(costmap) ? relative : `${relative}/${costmap}`).replace(/\//g, " ");
	return { service, costmap, node: `${where}/${costmap}`, label: text.charAt(0).toUpperCase() + text.slice(1) };
}

// ClearEntireCostmap services -> the costmaps to clear
export function clearableCostmaps(ns, services) {
	return servicesIn(ns, services).map((s) => costmapService(ns, s, /^clear_entirely_/));
}

// GetCost / GetCosts services -> the costmaps to ask, each with its node (for its frame)
export function costmapsToAsk(services) {
	return [...services].sort().map((s) => costmapService("", s, /^get_cost_/));
}

// a topic a node names relative to itself: ("/robot1/collision_monitor", "local_costmap/x")
//   -> "/robot1/local_costmap/x"
export function topicOfNode(node, topic) {
	if (topic.startsWith("/"))
		return topic;
	const path = `/${String(node).replace(/^\/+/, "")}`;
	const nodeNamespace = path.slice(0, path.lastIndexOf("/"));
	return `${nodeNamespace}/${topic}`;
}
