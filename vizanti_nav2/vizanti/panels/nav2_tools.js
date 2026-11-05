// The Nav2 Tools panel: what a Nav2 user otherwise does from a terminal. Clear the costmaps, run
// one of behavior_server's recovery behaviours (spin, back up, drive on heading, wait, assisted
// teleop), and see the state of every node the lifecycle managers run. RViz has none of this;
// the logic is in ../nav2_tools_logic.js.
import { PanelPlugin, WIDGET_PROPERTIES } from '@vizanti/plugin_api.js';
import { managerNodes } from '../nav2_compat.js';
import {
	CLEAR_COSTMAPS, CLEAR_TYPE, clearText, BEHAVIORS, behavior, behaviorGoal, behaviorFeedbackText,
	behaviorResultText, nodeNames, stateLabel, nodePath, managerSummary,
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
		this.status.ok("Ready.");
		this.poll();
	}

	onDestroy() {
		this.destroyed = true;
		clearTimeout(this.pollTimer);
		this.running?.handle.cancel();
	}

	buildPanel(container) {
		container.classList.add("nav2_panel", "nav2_tools");
		this.container = container;

		// costmaps
		const costmaps = el("fieldset", "nav2_box");
		costmaps.append(el("legend", "", "Costmaps"));
		const clearRow = el("div", "nav2_row");
		this.clearButtons = [];
		for (const which of [...CLEAR_COSTMAPS.map((c) => [c]), CLEAR_COSTMAPS]) {
			const b = el("button", "nav2_button", which.length > 1 ? "Clear both" : `Clear ${which[0].label.toLowerCase()}`);
			b.type = "button";
			b.title = which.map((c) => c.service).join(", ");
			b.addEventListener("click", () => this.clear(which));
			clearRow.appendChild(b);
			this.clearButtons.push(b);
		}
		this.clearNote = el("p", "nav2_tools_line");
		costmaps.append(clearRow, this.clearNote);

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
				row.append(input, el("span", "nav2_tools_unit", unit));
			}
			behaviours.appendChild(row);
		}
		this.cancelButton = el("button", "nav2_button", "Cancel behaviour");
		this.cancelButton.type = "button";
		this.cancelButton.addEventListener("click", () => this.running?.handle.cancel());
		this.behaviorNote = el("p", "nav2_tools_line");
		behaviours.append(this.cancelButton, this.behaviorNote);

		// lifecycle nodes
		const nodes = el("fieldset", "nav2_box");
		nodes.append(el("legend", "", "Lifecycle nodes"));
		this.nodeTable = el("table", "nav2_tools_nodes");
		nodes.appendChild(this.nodeTable);

		container.append(costmaps, behaviours, nodes);
		this.render();
	}

	// ---- costmaps ----

	async clear(costmaps) {
		this.clearLine = `Clearing ${costmaps.map((c) => c.label.toLowerCase()).join(" and ")} costmap…`;
		this.render();
		const lines = await Promise.all(costmaps.map(async (c) => {
			try {
				return clearText(c.label, await this.ctx.callService(c.service, CLEAR_TYPE, {}, 5000));
			} catch (e) {
				return `${c.label} costmap: ${e.message}`;
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
		const handle = this.ctx.action(b.action, b.type).send(goal, {
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
			const names = managerNodes(await this.ctx.listServices("nav2_msgs/srv/ManageLifecycleNodes")).sort();
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
				response = await this.ctx.callService(`${nodePath(node)}/get_state`, "lifecycle_msgs/srv/GetState", {}, 1500);
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
		this.clearNote.textContent = this.clearLine;
		this.clearNote.hidden = !this.clearLine;
		for (const [key, button] of Object.entries(this.behaviorButtons))
			button.disabled = !!this.running && this.running.key !== key;
		this.cancelButton.disabled = !this.running;
		this.behaviorNote.textContent = this.behaviorLine;
		this.behaviorNote.hidden = !this.behaviorLine;

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
