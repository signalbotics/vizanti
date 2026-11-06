// The Route Tool panel (nav2_rviz_plugins/Route Tool) for Vizanti: build and edit a Nav2 route
// graph. Add / Edit / Remove nodes and edges by id, load and save nav2_route GeoJSON, and see
// the graph on /route_graph (a MarkerArray display shows it). A point published with the
// Publish Point tool (/clicked_point) fills the X and Y fields, as in RViz.
// Beyond RViz, the Route tab asks Nav2's route server for a route over the graph it has loaded
// and drives it (see ../route_logic.js).
import { PanelPlugin, WIDGET_PROPERTIES } from '@vizanti/plugin_api.js';
import { RouteGraph, parseNumber, parseId } from '../route_graph_logic.js';
import { COMPUTE_ROUTE, NAVIGATE_THROUGH, PATH_TOPIC, routeGoal, routeSummary, routeErrorText, routeWaypoints, driveFeedbackText, driveErrorText } from '../route_logic.js';
import { ntpGoal, ntpPosesIsArray } from '../nav2_compat.js';
import { NAMESPACE_PROPERTY, inNamespace } from '../nav2_names.js';

if (!document.querySelector("link[data-vizanti-nav2]")) {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = new URL("../nav2.css", import.meta.url).href;
	link.dataset.vizantiNav2 = "";
	document.head.appendChild(link);
}

const el = (tag, className = "", text = "") => {
	const element = document.createElement(tag);
	if (className)
		element.className = className;
	if (text)
		element.textContent = text;
	return element;
};

// the field labels for nodes and for edges (on_*_button_toggled)
const LABELS = { node: ["Position:", "X:", "Y:"], edge: ["Connections:", "Start Node ID:", "End Node ID:"] };

export class RouteToolPanel extends PanelPlugin {

	static properties = { namespace: NAMESPACE_PROPERTY, ...WIDGET_PROPERTIES };

	onCreate() {
		this.graph = new RouteGraph();
		this.unsubscribe = this.ctx.subscribe("/clicked_point", "geometry_msgs/msg/PointStamped", 0, (msg) => {
			if (!this.add)
				return;
			for (const [x, y] of [[this.add.f1, this.add.f2], [this.edit.f1, this.edit.f2], [this.route.x, this.route.y]]) {
				x.value = msg.point.x.toFixed(6);
				y.value = msg.point.y.toFixed(6);
			}
			this.route.frame = msg.header?.frame_id || "map";
		});
		this.status.ok("Route graph: empty");
	}

	onDestroy() {
		this.unsubscribe?.();
		this.routing?.cancel();
	}

	buildPanel(container) {
		container.classList.add("nav2_panel", "nav2_route");
		const tabBar = el("div", "nav2_tabbar");
		this.tabs = {};
		for (const name of ["Add", "Edit", "Remove", "Route"]) {
			const tab = el("button", "nav2_tab", name);
			tab.type = "button";
			tab.addEventListener("click", () => this.showTab(name));
			this.tabs[name] = tab;
			tabBar.appendChild(tab);
		}
		this.add = this.buildFieldsPage("add", "Create", () => this.create());
		this.edit = this.buildFieldsPage("edit", "Confirm", () => this.confirm(), true);
		this.remove = this.buildRemovePage();
		this.route = this.buildRoutePage();
		this.pages = { Add: this.add.page, Edit: this.edit.page, Remove: this.remove.page, Route: this.route.page };

		this.note = el("p", "nav2_note");
		const files = el("div", "nav2_row");
		const load = el("button", "nav2_button", "Load");
		const save = el("button", "nav2_button", "Save");
		load.type = save.type = "button";
		this.fileInput = el("input");
		this.fileInput.type = "file";
		this.fileInput.accept = ".geojson,.json,application/geo+json,application/json";
		this.fileInput.hidden = true;
		this.fileInput.addEventListener("change", () => this.load(this.fileInput.files?.[0]));
		load.addEventListener("click", () => this.fileInput.click());
		save.addEventListener("click", () => this.save());
		files.append(load, save, this.fileInput);

		container.append(tabBar, this.add.page, this.edit.page, this.remove.page, this.route.page, this.note, files);
		this.showTab("Add");
	}

	// Node / Edge choice, then the fields (Add and Edit pages)
	buildFieldsPage(prefix, action, onAction, withId = false) {
		const page = el("div", "nav2_tabpage");
		const fields = { page, text: el("span", "nav2_heading"), l1: el("label"), l2: el("label"), f1: el("input"), f2: el("input") };
		fields.kind = this.kindChoice(prefix, () => this.relabel(fields));
		const grid = el("div", "nav2_grid");
		if (withId) {
			fields.id = el("input");
			grid.append(el("label", "", "ID:"), fields.id);
		}
		grid.append(fields.l1, fields.f1, fields.l2, fields.f2);
		const button = el("button", "nav2_button", action);
		button.type = "button";
		button.addEventListener("click", onAction);
		page.append(fields.kind.row, fields.text, grid, button);
		this.relabel(fields);
		return fields;
	}

	buildRemovePage() {
		const page = el("div", "nav2_tabpage");
		const kind = this.kindChoice("remove", () => {});
		const grid = el("div", "nav2_grid");
		const id = el("input");
		grid.append(el("label", "", "ID:"), id);
		const button = el("button", "nav2_button", "Delete");
		button.type = "button";
		button.addEventListener("click", () => this.delete());
		page.append(kind.row, grid, button);
		return { page, kind, id };
	}

	// Route: from one node to another, or from the robot to a point; Compute, Drive, Cancel
	buildRoutePage() {
		const page = el("div", "nav2_tabpage");
		const route = { page, frame: "map" };
		route.kind = this.kindChoice("route", () => this.renderRoute(), [["ids", "Node IDs"], ["point", "From the robot"]]);
		const ids = el("div", "nav2_grid");
		route.start = el("input");
		route.goal = el("input");
		ids.append(el("label", "", "Start node ID:"), route.start, el("label", "", "Goal node ID:"), route.goal);
		const point = el("div", "nav2_grid");
		route.x = el("input");
		route.y = el("input");
		point.append(el("label", "", "Goal X:"), route.x, el("label", "", "Goal Y:"), route.y);
		route.ids = ids;
		route.point = point;
		const buttons = el("div", "nav2_row");
		route.compute = el("button", "nav2_button", "Compute");
		route.drive = el("button", "nav2_button", "Drive");
		route.cancel = el("button", "nav2_button", "Cancel");
		for (const b of [route.compute, route.drive, route.cancel])
			b.type = "button";
		route.compute.title = "Ask the route server for a route (ComputeRoute). The robot does not move.";
		route.drive.title = "Compute the route, then drive through its nodes (NavigateThroughPoses).";
		route.compute.addEventListener("click", () => this.routeTo(false));
		route.drive.addEventListener("click", () => this.routeTo(true));
		route.cancel.addEventListener("click", () => this.routing?.cancel());
		buttons.append(route.compute, route.drive, route.cancel);
		route.note = el("p", "nav2_route_line");
		const hint = el("p", "nav2_route_hint", `Uses the graph the route server has loaded. The route is published on ${PATH_TOPIC}: add a Path display to see it.`);
		page.append(route.kind.row, ids, point, buttons, route.note, hint);
		this.routeLine = "";
		this.routing = null; // { cancel(), phase }
		return route;
	}

	renderRoute() {
		const r = this.route;
		r.ids.hidden = r.kind.value !== "ids";
		r.point.hidden = r.kind.value !== "point";
		r.compute.disabled = r.drive.disabled = !!this.routing;
		r.cancel.disabled = !this.routing;
		r.note.textContent = this.routeLine;
		r.note.hidden = !this.routeLine;
	}

	setRouteLine(text, error = false) {
		this.routeLine = text;
		this.route.note.classList.toggle("nav2_error", error);
		if (error)
			this.status.warn(text);
		this.renderRoute();
	}

	async routeTo(drive) {
		if (this.routing)
			return;
		const r = this.route;
		const t = Date.now();
		const stamp = { sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1e6 };
		const { goal, error } = routeGoal({ mode: r.kind.value, start: r.start.value, goal: r.goal.value, x: r.x.value, y: r.y.value }, r.frame, stamp);
		if (error)
			return this.setRouteLine(error, true);
		const computing = this.ctx.action(inNamespace(this.props.namespace, COMPUTE_ROUTE.action), COMPUTE_ROUTE.type).send(goal);
		this.routing = { cancel: () => computing.cancel() };
		this.setRouteLine("Computing the route…");
		const { status, values, ok } = await computing.result;
		if (!ok || status !== "succeeded") {
			this.routing = null;
			return this.setRouteLine(!ok ? `No route: ${values}` : (status === "canceled" ? "Cancelled." : `No route: ${routeErrorText(values, r.kind.value === "ids")}.`), status !== "canceled");
		}
		this.ctx.publish(PATH_TOPIC, "nav_msgs/msg/Path", values.path, { latched: true });
		const summary = routeSummary(values);
		if (!drive) {
			this.routing = null;
			return this.setRouteLine(summary + ".");
		}
		const waypoints = routeWaypoints(values.route, stamp);
		if (waypoints.length === 0) {
			this.routing = null;
			return this.setRouteLine(`${summary}. It has no nodes to drive through.`, true);
		}
		let posesIsArray = false;
		try {
			posesIsArray = await ntpPosesIsArray(this.ctx);
		} catch (e) {
			// rosapi did not answer: the newer form
		}
		const driving = this.ctx.action(inNamespace(this.props.namespace, NAVIGATE_THROUGH.action), NAVIGATE_THROUGH.type).send(
			ntpGoal(waypoints, waypoints[0].header.frame_id, stamp, "", posesIsArray), {
				onFeedback: (fb) => this.setRouteLine(`${summary}. Driving: ${driveFeedbackText(fb)}`),
			});
		this.routing = { cancel: () => driving.cancel() };
		this.setRouteLine(`${summary}. Driving…`);
		const done = await driving.result;
		this.routing = null;
		if (done.ok && done.status === "succeeded")
			this.setRouteLine(`${summary}. Arrived.`);
		else if (done.status === "canceled")
			this.setRouteLine(`${summary}. Stopped.`);
		else
			this.setRouteLine(`${summary}. The drive failed: ${done.ok ? driveErrorText(done.values) : done.values}.`, true);
	}

	kindChoice(prefix, onChange, options = [["node", "Node"], ["edge", "Edge"]]) {
		const row = el("div", "nav2_row nav2_route_kind");
		const choice = { row, value: options[0][0] };
		for (const [value, label] of options) {
			const wrap = el("label", "nav2_check");
			const radio = el("input");
			radio.type = "radio";
			radio.name = `${prefix}_${this.id}`;
			radio.checked = value === options[0][0];
			radio.addEventListener("change", () => {
				choice.value = value;
				onChange();
			});
			wrap.append(radio, document.createTextNode(` ${label}`));
			row.appendChild(wrap);
		}
		return choice;
	}

	relabel(fields) {
		const [text, l1, l2] = LABELS[fields.kind.value];
		fields.text.textContent = text;
		fields.l1.textContent = l1;
		fields.l2.textContent = l2;
	}

	showTab(name) {
		for (const [key, tab] of Object.entries(this.tabs)) {
			tab.classList.toggle("active", key === name);
			this.pages[key].hidden = key !== name;
		}
		if (name === "Route")
			this.renderRoute();
	}

	// ---- actions ----

	create() {
		const { kind, f1, f2 } = this.add;
		if (f1.value.trim() === "" || f2.value.trim() === "")
			return;
		this.change(() => {
			if (kind.value === "node") {
				const [x, y] = this.numbers(f1, f2);
				return `Added node ${this.graph.addNode(x, y)}.`;
			}
			const [start, end] = this.ids(f1, f2);
			return `Added edge ${this.graph.addEdge(start, end)} from node ${start} to node ${end}.`;
		}, [f1, f2]);
	}

	confirm() {
		const { kind, id, f1, f2 } = this.edit;
		if (id.value.trim() === "" || f1.value.trim() === "" || f2.value.trim() === "")
			return;
		this.change(() => {
			const [target] = this.ids(id);
			if (kind.value === "node") {
				const [x, y] = this.numbers(f1, f2);
				this.graph.editNode(target, x, y);
				return `Moved node ${target}.`;
			}
			const [start, end] = this.ids(f1, f2);
			this.graph.editEdge(target, start, end);
			return `Edge ${target} now joins node ${start} to node ${end}.`;
		}, [id, f1, f2]);
	}

	delete() {
		const { kind, id } = this.remove;
		if (id.value.trim() === "")
			return;
		this.change(() => {
			const [target] = this.ids(id);
			if (kind.value === "node") {
				this.graph.removeNode(target);
				return `Removed node ${target} and its edges.`;
			}
			this.graph.removeEdge(target);
			return `Removed edge ${target}.`;
		}, [id]);
	}

	// runs an edit; on success the fields clear and the graph is published again
	change(edit, clear) {
		try {
			this.note.textContent = edit();
			this.note.classList.remove("nav2_error");
			for (const input of clear)
				input.value = "";
			this.publish();
		} catch (e) {
			this.note.textContent = e.message;
			this.note.classList.add("nav2_error");
		}
	}

	numbers(...inputs) {
		return inputs.map((input) => {
			const n = parseNumber(input.value);
			if (n === null)
				throw new Error(`"${input.value}" is not a number.`);
			return n;
		});
	}

	ids(...inputs) {
		return inputs.map((input) => {
			const n = parseId(input.value);
			if (n === null)
				throw new Error(`"${input.value}" is not an id.`);
			return n;
		});
	}

	publish() {
		const t = Date.now();
		this.ctx.publish("/route_graph", "visualization_msgs/msg/MarkerArray", this.graph.markers({ sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1e6 }), { latched: true });
		this.status.ok(`Route graph: ${this.graph.nodes.size} nodes, ${this.graph.edges.size} edges`);
	}

	async load(file) {
		this.fileInput.value = "";
		if (!file)
			return;
		try {
			this.graph = RouteGraph.fromGeoJson(await file.text());
			this.note.textContent = `Loaded ${file.name}.`;
			this.note.classList.remove("nav2_error");
			this.publish();
		} catch (e) {
			this.note.textContent = `${file.name}: ${e.message}`;
			this.note.classList.add("nav2_error");
		}
	}

	save() {
		const blob = new Blob([this.graph.toGeoJson()], { type: "application/geo+json" });
		const link = document.createElement("a");
		link.href = URL.createObjectURL(blob);
		link.download = "route_graph.geojson";
		link.click();
		setTimeout(() => URL.revokeObjectURL(link.href), 1000);
	}
}
