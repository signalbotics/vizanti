// The Selector panel (nav2_rviz_plugins/Selector) without the page: which plugin lists it reads
// and where each choice is published. Pure, so it runs under node --test.

// one drop-down each, in the RViz panel's order: [key, label, server node, parameter, topic]
export const SELECTORS = [
	["controller", "Controller", "controller_server", "controller_plugins", "controller_selector"],
	["planner", "Planner", "planner_server", "planner_plugins", "planner_selector"],
	["goal_checker", "Goal Checker", "controller_server", "goal_checker_plugins", "goal_checker_selector"],
	["smoother", "Smoother", "smoother_server", "smoother_plugins", "smoother_selector"],
	["progress_checker", "Progress Checker", "controller_server", "progress_checker_plugins", "progress_checker_selector"],
	["path_handler", "Path Handler", "controller_server", "path_handler_plugins", "path_handler_selector"],
].map(([key, label, server, parameter, topic]) => ({ key, label, server, parameter, topic }));

const PARAMETER_STRING_ARRAY = 9; // rcl_interfaces/ParameterType

// rcl_interfaces/srv/GetParameters response -> the plugin names, or null when the parameter is
// not set on that server
export function pluginNames(response) {
	const value = response?.values?.[0];
	if (!value || value.type !== PARAMETER_STRING_ARRAY)
		return null;
	return [...(value.string_array_value ?? [])];
}

// The server answered, but has no such parameter: that Nav2 has no plugins of this kind
// (path_handler_plugins is new in Kilted; Humble and Jazzy have no Path Handler).
export function parameterUnset(response) {
	const value = response?.values?.[0];
	return !value || value.type === 0; // PARAMETER_NOT_SET
}

// the items a drop-down shows once loaded (pluginLoader: "Default" first, selected)
export function initialItems(names) {
	return ["Default", ...names];
}

// a choice was made (Selector::setSelection): "Default" leaves the list for good, and the
// selected plugin is published. Returns { items, selected, publish } (publish null: nothing to send).
export function choose(items, chosen) {
	let rest = items;
	let selected = chosen;
	if (items[0] === "Default") {
		rest = items.slice(1);
		if (chosen === "Default")
			selected = rest[0]; // Qt shows the next item once "Default" is removed
	}
	if (rest.length === 0)
		return { items: rest, selected: null, publish: null };
	return { items: rest, selected, publish: selected };
}
