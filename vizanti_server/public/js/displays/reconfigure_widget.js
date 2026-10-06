import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

// rcl_interfaces ParameterType ordinals the Vizanti service reports (1 to 4; arrays are left out)
export const PARAM_TYPES = { 1: "bool", 2: "int", 3: "float", 4: "string" };

// [name, value, type][] -> nested groups by the dots in the names:
// { name: [fullname, value, type] | { ...group } }
export function groupParameters(list) {
	const root = {};
	for (const [name, value, type] of list) {
		const parts = name.split(".");
		let group = root;
		for (let i = 0; i < parts.length - 1; i++) {
			if (!group[parts[i]] || Array.isArray(group[parts[i]]))
				group[parts[i]] = {};
			group = group[parts[i]];
		}
		group[parts.at(-1)] = [name, value, type];
	}
	return root;
}

// the text the set service expects for a value typed in: null when it is not valid
export function parameterText(type, raw) {
	switch (PARAM_TYPES[type]) {
		case "bool": return raw ? "true" : "false";
		case "int": {
			const value = Number(raw);
			return Number.isInteger(value) && String(raw).trim() !== "" ? String(value) : null;
		}
		case "float": {
			const value = Number(raw);
			return Number.isFinite(value) && String(raw).trim() !== "" ? String(value) : null;
		}
		case "string": return String(raw);
		default: return null;
	}
}

// Lists a node's parameters and sets them (through the Vizanti server's parameter services).
export class ReconfigureWidget extends WidgetDisplay {

	static type = "reconfigure";
	static label = "Parameter Reconfigure";
	static icon = "assets/reconfigure.svg";
	static description = "Read and set the parameters of a running node";
	static properties = {
		node: { type: "string", label: "Node", default: "", help: "Pick it in the panel." },
		...WIDGET_PROPERTIES,
	};

	get iconColor() {
		return null;
	}

	onCreate() {
		this.status.ok("Open the panel to pick a node.");
	}

	onPropertyChange(key) {
		if (key === "node" && this.panelElement?.isConnected)
			this.loadParameters();
	}

	buildPanel(container) {
		const row = document.createElement("div");
		row.className = "widget_row";
		this.nodeSelect = document.createElement("select");
		this.nodeSelect.setAttribute("aria-label", "Node");
		this.nodeSelect.addEventListener("change", () => this.setProp("node", this.nodeSelect.value));
		this.nodeSelect.addEventListener("focus", () => this.loadNodes());
		const refresh = document.createElement("button");
		refresh.type = "button";
		refresh.textContent = "Refresh";
		refresh.addEventListener("click", () => {
			this.loadNodes();
			this.loadParameters();
		});
		row.append(this.nodeSelect, refresh);
		this.note = document.createElement("p");
		this.note.className = "comment";
		this.params = document.createElement("div");
		this.params.className = "reconfigure_params";
		container.append(row, this.note, this.params);
	}

	attachPanel(host) {
		super.attachPanel(host);
		this.loadNodes();
		this.loadParameters();
	}

	async loadNodes() {
		let nodes = [];
		try {
			nodes = (await this.ctx.listNodes()).filter((name) => !name.includes("vizanti")).sort();
		} catch (e) {
			this.note.textContent = `The node list did not arrive: ${e.message}`;
			return;
		}
		const current = this.props.node;
		if (current && !nodes.includes(current))
			nodes.unshift(current);
		this.nodeSelect.replaceChildren(...[["", "(pick a node)"], ...nodes.map((n) => [n, n])].map(([value, label]) => {
			const option = document.createElement("option");
			option.value = value;
			option.textContent = label;
			return option;
		}));
		this.nodeSelect.value = current;
	}

	async loadParameters() {
		const node = this.props.node;
		this.params.replaceChildren();
		if (!node) {
			this.note.textContent = "Pick a node.";
			return;
		}
		this.note.textContent = "Loading parameters...";
		let list;
		try {
			const response = await this.ctx.callService("/vizanti/get_node_parameters", "vizanti_msgs/srv/GetNodeParameters", { node });
			list = JSON.parse(response.parameters);
		} catch (e) {
			if (this.props.node === node) {
				this.note.textContent = `Could not read the parameters: ${e.message}`;
				this.status.error(`Could not read the parameters of ${node}.`);
			}
			return;
		}
		if (this.props.node !== node)
			return;
		this.status.ok();
		this.note.textContent = list.length ? `${list.length} parameters. Changes are sent when a field is left or Enter is pressed.` : "This node has no parameters Vizanti can edit (bool, int, float, string).";
		this.params.replaceChildren();
		this.addGroup(this.params, groupParameters(list));
	}

	addGroup(container, group) {
		// plain parameters first, then the groups
		const entries = Object.entries(group).sort(([a, x], [b, y]) => (Array.isArray(y) - Array.isArray(x)) || a.localeCompare(b));
		for (const [name, entry] of entries) {
			if (Array.isArray(entry)) {
				container.appendChild(this.parameterRow(name, ...entry));
				continue;
			}
			const details = document.createElement("details");
			const summary = document.createElement("summary");
			summary.textContent = name;
			details.appendChild(summary);
			this.addGroup(details, entry);
			container.appendChild(details);
		}
	}

	parameterRow(shortName, fullName, value, type) {
		const row = document.createElement("div");
		row.className = "prop_row";
		const label = document.createElement("label");
		const kind = document.createElement("i");
		kind.textContent = `${PARAM_TYPES[type]} `;
		label.append(kind, shortName);
		label.title = fullName;
		const input = document.createElement("input");
		if (PARAM_TYPES[type] === "bool") {
			input.type = "checkbox";
			input.checked = !!value;
		} else if (PARAM_TYPES[type] === "string") {
			input.type = "text";
			input.value = value;
		} else {
			input.type = "number";
			input.step = PARAM_TYPES[type] === "int" ? "1" : "any";
			input.value = value;
		}
		const mark = document.createElement("span");
		mark.className = "param_mark";
		input.addEventListener("change", () => this.send(fullName, type, input.type === "checkbox" ? input.checked : input.value, mark));
		row.append(label, input, mark);
		return row;
	}

	async send(param, type, raw, mark) {
		const text = parameterText(type, raw);
		if (text === null) {
			mark.textContent = "✗";
			mark.title = "Not a valid value for this parameter.";
			return;
		}
		mark.textContent = "…";
		mark.title = "Sending";
		try {
			const response = await this.ctx.callService("/vizanti/set_node_parameter", "vizanti_msgs/srv/SetNodeParameter", { node: this.props.node, param, value: text });
			const ok = response.status === "Ok.";
			mark.textContent = ok ? "✓" : "✗";
			mark.title = response.status;
		} catch (e) {
			mark.textContent = "✗";
			mark.title = e.message;
		}
	}
}
