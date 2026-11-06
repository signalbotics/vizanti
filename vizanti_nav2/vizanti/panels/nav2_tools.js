// The Nav2 Tools panel: what a Nav2 user otherwise does from a terminal. Clear the costmaps, run
// one of behavior_server's recovery behaviours (spin, back up, drive on heading, wait, assisted
// teleop), plan a path without driving it (and drive it if it looks right), save the map, and
// see the state of every node the lifecycle managers run. RViz has none of this; the logic is in
// ../nav2_tools_logic.js.
import { PanelPlugin, WIDGET_PROPERTIES } from '@vizanti/plugin_api.js';
import { managerNodes } from '../nav2_compat.js';
import { NAMESPACE_PROPERTY, inNamespace, normalizeNamespace, servicesIn, clearableCostmaps, topicOfNode } from '../nav2_names.js';
import {
	CLEAR_TYPE, clearText, BEHAVIORS, behavior, behaviorGoal, behaviorFeedbackText,
	behaviorResultText, nodeNames, stateLabel, managerSummary,
	COMPUTE_PATH, FOLLOW_PATH, PLAN_TOPIC, planGoal, planSummary, planErrorText, followErrorText,
	SAVE_MAP, saveMapRequest, saveMapText, NO_MAP_SAVER,
} from '../nav2_tools_logic.js';

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

const COLORS = { green: "#3ecf6e", orange: "#f5a623", red: "#ff6b6b", blue: "#5aa9ff", grey: "#9aa0a6" };
const NODES_EVERY_MS = 2000;
const MANAGERS_EVERY_MS = 10000;

export class Nav2ToolsPanel extends PanelPlugin {

	static properties = {
		namespace: NAMESPACE_PROPERTY,
		time_limit: { type: "float", label: "Behaviour time limit (s)", default: 10, min: 0, step: 1, help: "How long spin, back up and drive on heading may take before Nav2 stops them. 0: no limit." },
		...WIDGET_PROPERTIES,
	};

	onCreate() {
		this.values = Object.fromEntries(BEHAVIORS.map((b) => [b.key, Object.fromEntries(b.fields.map(([k, , , d]) => [k, d]))]));
		this.running = null; // { key, handle }
		this.behaviorLine = "";
		this.clearLine = "";
		this.managers = []; // [{ name, nodes: [names], states: { node: {text, color} } }]
		this.managersAt = 0;
		this.costmaps = []; // [{ service, label }] found by type in the namespace
		this.plan = null; // the last planned path
		this.planning = null; // { cancel() } while planning or driving
		this.planLine = "";
		this.mapLine = "";
		this.planFrame = "map";
		this.unsubscribe = this.ctx.subscribe("/clicked_point", "geometry_msgs/msg/PointStamped", 0, (msg) => {
			if (!this.planX)
				return;
			this.planX.value = msg.point.x.toFixed(3);
			this.planY.value = msg.point.y.toFixed(3);
			this.planFrame = msg.header?.frame_id || "map";
		});
		this.status.ok("Ready.");
		this.poll();
	}

	onDestroy() {
		this.destroyed = true;
		clearTimeout(this.pollTimer);
		this.running?.handle.cancel();
		this.planning?.cancel();
		this.unsubscribe?.();
	}

	buildPanel(container) {
		container.classList.add("nav2_panel", "nav2_tools");
		this.container = container;

		// costmaps
		const costmaps = el("fieldset", "nav2_box");
		costmaps.append(el("legend", "", "Costmaps"));
		// one button per costmap found (ClearEntireCostmap services), then "Clear all"
		this.clearRow = el("div", "nav2_row nav2_tools_wrap");
		this.clearNote = el("p", "nav2_tools_line");
		costmaps.append(this.clearRow, this.clearNote);

		// behaviours
		const behaviours = el("fieldset", "nav2_box");
		behaviours.append(el("legend", "", "Behaviours"));
		this.behaviorButtons = {};
		for (const b of BEHAVIORS) {
			const row = el("div", "nav2_row nav2_tools_behavior");
			const button = el("button", "nav2_button", b.label);
			button.type = "button";
			button.title = `${b.help} (${b.action})`;
			button.addEventListener("click", () => this.run(b.key));
			this.behaviorButtons[b.key] = button;
			row.appendChild(button);
			for (const [field, label, unit] of b.fields) {
				const input = el("input");
				input.type = "number";
				input.step = unit === "°" ? "15" : (unit === "s" ? "1" : "0.05");
				input.value = this.values[b.key][field];
				input.title = `${label} (${unit})`;
				input.setAttribute("aria-label", `${b.label} ${label.toLowerCase()} in ${unit}`);
				input.addEventListener("change", () => { this.values[b.key][field] = Number(input.value); });
				// a number and its unit stay together; on a narrow panel they wrap under the button
				const field = el("span", "nav2_tools_field");
				field.append(input, el("span", "nav2_tools_unit", unit));
				row.append(field);
			}
			behaviours.appendChild(row);
		}
		this.cancelButton = el("button", "nav2_button", "Cancel behaviour");
		this.cancelButton.type = "button";
		this.cancelButton.addEventListener("click", () => this.running?.handle.cancel());
		this.behaviorNote = el("p", "nav2_tools_line");
		behaviours.append(this.cancelButton, this.behaviorNote);

		// plan without driving
		const plan = el("fieldset", "nav2_box");
		plan.append(el("legend", "", "Plan"));
		const goalGrid = el("div", "nav2_grid");
		this.planX = el("input");
		this.planY = el("input");
		this.planYaw = el("input");
		this.planYaw.value = "0";
		this.plannerId = el("input");
		this.plannerId.placeholder = "default";
		goalGrid.append(el("label", "", "Goal X:"), this.planX, el("label", "", "Goal Y:"), this.planY,
			el("label", "", "Yaw (°):"), this.planYaw, el("label", "", "Planner:"), this.plannerId);
		const planButtons = el("div", "nav2_row");
		this.planButton = el("button", "nav2_button", "Plan");
		this.planButton.title = "Ask the planner for a path from the robot to the goal (ComputePathToPose). The robot does not move.";
		this.drivePlanButton = el("button", "nav2_button", "Drive plan");
		this.drivePlanButton.title = "Follow the last planned path with the controller (FollowPath).";
		this.cancelPlanButton = el("button", "nav2_button", "Cancel");
		for (const b of [this.planButton, this.drivePlanButton, this.cancelPlanButton])
			b.type = "button";
		this.planButton.addEventListener("click", () => this.makePlan());
		this.drivePlanButton.addEventListener("click", () => this.drivePlan());
		this.cancelPlanButton.addEventListener("click", () => this.planning?.cancel());
		planButtons.append(this.planButton, this.drivePlanButton, this.cancelPlanButton);
		this.planNote = el("p", "nav2_tools_line");
		plan.append(goalGrid, planButtons, this.planNote, el("p", "nav2_tools_hint", `Publish Point fills X and Y. The path is published on ${PLAN_TOPIC}: add a Path display to see it.`));

		// save the map
		const map = el("fieldset", "nav2_box");
		map.append(el("legend", "", "Map"));
		const mapGrid = el("div", "nav2_grid");
		this.mapPath = el("input");
		this.mapPath.placeholder = "/home/robot/maps/office";
		this.mapPath.title = "On the robot, without an extension: <path>.pgm (or .png) and <path>.yaml are written.";
		this.mapFormat = el("select");
		for (const f of ["pgm", "png", "bmp"])
			this.mapFormat.appendChild(new Option(f, f));
		this.mapMode = el("select");
		for (const [v, l] of [["trinary", "trinary (free / occupied / unknown)"], ["scale", "scale (keeps the probabilities)"], ["raw", "raw (the cell values)"]])
			this.mapMode.appendChild(new Option(l, v));
		this.mapTopic = el("input");
		this.mapTopic.value = "/map";
		mapGrid.append(el("label", "", "Save to:"), this.mapPath, el("label", "", "Format:"), this.mapFormat,
			el("label", "", "Mode:"), this.mapMode, el("label", "", "Map topic:"), this.mapTopic);
		this.saveMapButton = el("button", "nav2_button", "Save map");
		this.saveMapButton.type = "button";
		this.saveMapButton.addEventListener("click", () => this.saveMap());
		this.mapNote = el("p", "nav2_tools_line");
		map.append(mapGrid, this.saveMapButton, this.mapNote);

		// lifecycle nodes
		const nodes = el("fieldset", "nav2_box");
		nodes.append(el("legend", "", "Lifecycle nodes"));
		this.nodeTable = el("table", "nav2_tools_nodes");
		nodes.appendChild(this.nodeTable);

		container.append(costmaps, behaviours, plan, map, nodes);
		this.render();
	}

	// ---- costmaps ----

	renderClearButtons() {
		const key = this.costmaps.map((c) => c.service).join("\n");
		if (this.clearRow.dataset.key === key)
			return;
		this.clearRow.dataset.key = key;
		const button = (text, title, costmaps) => {
			const b = el("button", "nav2_button", text);
			b.type = "button";
			b.title = title;
			b.addEventListener("click", () => this.clear(costmaps));
			return b;
		};
		const buttons = this.costmaps.map((c) => button(`Clear ${c.label.toLowerCase()}`, c.service, [c]));
		if (this.costmaps.length > 1)
			buttons.push(button("Clear all", this.costmaps.map((c) => c.service).join(", "), this.costmaps));
		if (buttons.length === 0)
			buttons.push(el("span", "nav2_tools_hint", "No costmap found yet (looking for nav2_msgs/srv/ClearEntireCostmap services)."));
		this.clearRow.replaceChildren(...buttons);
	}

	async clear(costmaps) {
		this.clearLine = `Clearing ${costmaps.map((c) => c.label.toLowerCase()).join(" and ")}…`;
		this.render();
		const lines = await Promise.all(costmaps.map(async (c) => {
			try {
				return clearText(c.label.replace(/ costmap$/i, ""), await this.ctx.callService(c.service, CLEAR_TYPE, {}, 5000));
			} catch (e) {
				return `${c.label}: ${e.message}`;
			}
		}));
		this.clearLine = lines.join(" ");
		this.render();
	}

	// ---- behaviours ----

	run(key) {
		if (this.running)
			return;
		const b = behavior(key);
		const goal = behaviorGoal(key, this.values[key], this.props.time_limit);
		const handle = this.ctx.action(this.nav2Name(b.action), b.type).send(goal, {
			onFeedback: (fb) => {
				this.behaviorLine = `${b.label}: ${behaviorFeedbackText(key, fb)}`;
				this.render();
			},
		});
		this.running = { key, handle };
		this.behaviorLine = `${b.label}: running…`;
		this.render();
		handle.result.then((result) => {
			if (this.running?.handle !== handle)
				return;
			this.running = null;
			this.behaviorLine = behaviorResultText(b.label, result);
			if (!result.ok || result.status === "aborted")
				this.status.warn(this.behaviorLine);
			this.render();
		});
	}

	// ---- plan without driving ----

	setPlanLine(text, error = false) {
		this.planLine = text;
		this.planNote.classList.toggle("nav2_error", error);
		if (error)
			this.status.warn(text);
		this.render();
	}

	async makePlan() {
		if (this.planning)
			return;
		const t = Date.now();
		const { goal, error } = planGoal({ x: this.planX.value, y: this.planY.value, yaw: this.planYaw.value, plannerId: this.plannerId.value.trim() },
			this.planFrame, { sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1e6 });
		if (error)
			return this.setPlanLine(error, true);
		const handle = this.ctx.action(this.nav2Name(COMPUTE_PATH.action), COMPUTE_PATH.type).send(goal);
		this.planning = { cancel: () => handle.cancel() };
		this.setPlanLine("Planning…");
		const { status, values, ok } = await handle.result;
		this.planning = null;
		if (!ok || status !== "succeeded") {
			this.plan = null;
			return this.setPlanLine(status === "canceled" ? "Cancelled." : `No path: ${ok ? planErrorText(values) : values}.`, status !== "canceled");
		}
		this.plan = values.path;
		this.ctx.publish(PLAN_TOPIC, "nav_msgs/msg/Path", values.path, { latched: true });
		this.setPlanLine(`${planSummary(values)}. Not driven.`);
	}

	async drivePlan() {
		if (this.planning || !this.plan)
			return;
		const summary = this.planLine.replace(/\. Not driven\.$/, "");
		const handle = this.ctx.action(this.nav2Name(FOLLOW_PATH.action), FOLLOW_PATH.type).send({ path: this.plan }, {
			onFeedback: (fb) => {
				const f = fb?.tracking_feedback ?? fb ?? {};
				if (typeof f.distance_to_goal === "number")
					this.setPlanLine(`${summary}. Driving: ${f.distance_to_goal.toFixed(2)} m to go`);
			},
		});
		this.planning = { cancel: () => handle.cancel() };
		this.setPlanLine(`${summary}. Driving…`);
		const { status, values, ok } = await handle.result;
		this.planning = null;
		if (ok && status === "succeeded")
			this.setPlanLine(`${summary}. Arrived.`);
		else if (status === "canceled")
			this.setPlanLine(`${summary}. Stopped.`);
		else
			this.setPlanLine(`${summary}. The drive failed: ${ok ? followErrorText(values) : values}.`, true);
	}

	// ---- save the map ----

	async saveMap() {
		const { request, error } = saveMapRequest({ path: this.mapPath.value, format: this.mapFormat.value, mode: this.mapMode.value, topic: this.mapTopic.value.trim() || "/map" });
		const say = (text, bad = false) => {
			this.mapLine = text;
			this.mapNote.classList.toggle("nav2_error", bad);
			if (bad)
				this.status.warn(text);
			this.render();
		};
		if (error)
			return say(error, true);
		let service = this.nav2Name(SAVE_MAP.service);
		try {
			const services = servicesIn(this.props.namespace, await this.ctx.listServices(SAVE_MAP.type));
			if (services.length === 0)
				return say(NO_MAP_SAVER, true);
			service = services.includes(service) ? service : services[0];
		} catch (e) {
			// rosapi did not answer: try the usual name
		}
		this.saveMapButton.disabled = true;
		say(`Saving ${request.map_url}…`);
		try {
			say(saveMapText(await this.ctx.callService(service, SAVE_MAP.type, request, 20000), request), false);
		} catch (e) {
			// the graph can still list a saver that has just stopped
			say(/does not exist|not available|InvalidService/i.test(e.message) ? NO_MAP_SAVER : `${service}: ${e.message}`, true);
		}
		this.saveMapButton.disabled = false;
		if (/could not/.test(this.mapLine))
			say(this.mapLine, true);
	}

	// a Nav2 name in the panel's namespace
	nav2Name(n) {
		return inNamespace(this.props.namespace, n);
	}

	onPropertyChange(key) {
		if (key !== "namespace")
			return;
		this.managers = [];
		this.costmaps = [];
		this.managersAt = 0;
		this.render();
	}

	// ---- lifecycle ----

	async poll() {
		if (this.destroyed)
			return;
		if (this.container?.isConnected) {
			try {
				await this.refreshNodes();
			} catch (e) {
				// rosbridge not connected yet: next round
			}
		}
		if (!this.destroyed)
			this.pollTimer = setTimeout(() => this.poll(), NODES_EVERY_MS);
	}

	async refreshNodes() {
		const now = Date.now();
		if (now - this.managersAt > MANAGERS_EVERY_MS || this.managers.length === 0) {
			this.managersAt = now;
			this.costmaps = clearableCostmaps(this.props.namespace, await this.ctx.listServices(CLEAR_TYPE));
			const ns = normalizeNamespace(this.props.namespace);
			const names = managerNodes(servicesIn(ns, await this.ctx.listServices("nav2_msgs/srv/ManageLifecycleNodes"))).sort();
			const old = new Map(this.managers.map((m) => [m.name, m]));
			this.managers = await Promise.all(names.map(async (name) => {
				let nodes = old.get(name)?.nodes ?? [];
				try {
					nodes = nodeNames(await this.ctx.callService(`/${name}/get_parameters`, "rcl_interfaces/srv/GetParameters", { names: ["node_names"] }, 3000));
				} catch (e) {
					// keep what it said before
				}
				return { name, nodes, states: old.get(name)?.states ?? {} };
			}));
		}
		await Promise.all(this.managers.flatMap((m) => m.nodes.map(async (node) => {
			let response = null;
			try {
				// node_names are relative to the manager's namespace
				response = await this.ctx.callService(`${topicOfNode(m.name, node)}/get_state`, "lifecycle_msgs/srv/GetState", {}, 1500);
			} catch (e) {
				response = null;
			}
			m.states[node] = stateLabel(response);
		})));
		this.render();
	}

	// ---- page ----

	render() {
		if (!this.container)
			return;
		this.renderClearButtons();
		this.clearNote.textContent = this.clearLine;
		this.clearNote.hidden = !this.clearLine;
		for (const [key, button] of Object.entries(this.behaviorButtons))
			button.disabled = !!this.running && this.running.key !== key;
		this.cancelButton.disabled = !this.running;
		this.behaviorNote.textContent = this.behaviorLine;
		this.behaviorNote.hidden = !this.behaviorLine;
		this.planButton.disabled = !!this.planning;
		this.drivePlanButton.disabled = !!this.planning || !this.plan;
		this.cancelPlanButton.disabled = !this.planning;
		this.planNote.textContent = this.planLine;
		this.planNote.hidden = !this.planLine;
		this.mapNote.textContent = this.mapLine;
		this.mapNote.hidden = !this.mapLine;

		const rows = [];
		if (this.managers.length === 0)
			rows.push(this.row("No Nav2 lifecycle manager found yet.", "", null, true));
		for (const m of this.managers) {
			const states = m.nodes.map((n) => m.states[n]).filter(Boolean);
			rows.push(this.row(states.length ? managerSummary(m.name, states) : m.name, "", null, true));
			for (const node of m.nodes) {
				const state = m.states[node] ?? { text: "…", color: null };
				rows.push(this.row(node, state.text, state.color));
			}
		}
		this.nodeTable.replaceChildren(...rows);
	}

	row(label, value, color, heading = false) {
		const tr = el("tr", heading ? "nav2_tools_manager" : "");
		const name = el("td", "", label);
		if (heading)
			name.colSpan = 2;
		tr.appendChild(name);
		if (!heading) {
			const td = el("td", "nav2_tools_state", value);
			if (color)
				td.style.color = COLORS[color];
			tr.appendChild(td);
		}
		return tr;
	}
}
