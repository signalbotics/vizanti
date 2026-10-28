// The Docking panel (nav2_rviz_plugins/Docking) for Vizanti: dock and undock the robot through
// Nav2's docking server, by dock id or by dock pose and type, as in RViz (see ../docking_logic.js).
import { PanelPlugin, WIDGET_PROPERTIES } from '@vizanti/plugin_api.js';
import { goalStatusLabel } from '../nav2_panel_logic.js';
import { pluginNames, initialItems } from '../selector_logic.js';
import { DOCK_STATES, TOOLTIPS, inputsEnabled, dockFeedbackRows, dockResultLabel, dropDefault, dockGoal, undockGoal } from '../docking_logic.js';

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

const COLORS = { green: "#3ecf6e", orange: "#f5a623", red: "#ff6b6b" };

export class DockingPanel extends PanelPlugin {

	static properties = { ...WIDGET_PROPERTIES };

	onCreate() {
		this.state = "pre_initial";
		this.useDockId = true;
		this.poseTouched = false;
		this.types = [];
		this.goal = null;
		this.goalStatus = goalStatusLabel(-1);
		this.feedback = dockFeedbackRows(null);
		this.result = "";
		// goals from anywhere show up, as the RViz panel follows the action status topics
		this.unsubscribe = ["/dock_robot/_action/status", "/undock_robot/_action/status"].map((topic) =>
			this.ctx.subscribe(topic, "action_msgs/msg/GoalStatusArray", 0, (msg) => {
				const last = msg.status_list?.[msg.status_list.length - 1];
				if (!last)
					return;
				this.goalStatus = goalStatusLabel(last.status);
				if (topic === "/dock_robot/_action/status" && last.status === 4)
					this.feedback = dockFeedbackRows(null);
				this.render();
			}));
		this.status.ok("Waiting for the Nav2 docking server…");
		this.waitForServer();
	}

	onDestroy() {
		this.destroyed = true;
		clearTimeout(this.retry);
		for (const off of this.unsubscribe ?? [])
			off?.();
		this.goal?.cancel();
	}

	// InitialDockThread: wait for the docking server, then load its dock types
	async waitForServer() {
		try {
			const response = await this.ctx.callService("/docking_server/get_parameters", "rcl_interfaces/srv/GetParameters", { names: ["dock_plugins"] }, 3000);
			if (this.destroyed)
				return;
			this.types = initialItems(pluginNames(response) ?? []);
			this.state = "idle";
			this.status.ok("Docking server ready.");
			this.render();
		} catch (e) {
			if (!this.destroyed)
				this.retry = setTimeout(() => this.waitForServer(), 1000);
		}
	}

	buildPanel(container) {
		container.classList.add("nav2_panel", "nav2_docking");
		const info = el("div", "nav2_row");
		this.statusTable = el("table", "nav2_status");
		this.resultLabel = el("span", "nav2_dock_result");
		info.append(this.statusTable, this.resultLabel);
		this.feedbackTable = el("table", "nav2_feedback");
		this.note = el("p", "nav2_note");

		const box = el("fieldset", "nav2_box");
		const check = (checked, tooltip, onChange) => {
			const input = el("input");
			input.type = "checkbox";
			input.checked = checked;
			input.title = tooltip;
			input.addEventListener("change", () => onChange(input.checked));
			return input;
		};
		this.navToStaging = check(true, TOOLTIPS.nav_to_staging, () => {});
		this.useDockIdBox = check(true, TOOLTIPS.use_dock_id, (on) => {
			this.useDockId = on;
			this.poseTouched = true;
			this.render();
		});
		this.dockId = el("input");
		this.dockType = el("select");
		this.pose = { x: el("input"), y: el("input"), yaw: el("input") };
		const label = (text) => el("label", "nav2_label", text);
		const stagingRow = el("div", "nav2_row");
		stagingRow.append(label("Nav. to staging pose"), this.navToStaging);
		const idRow = el("div", "nav2_row");
		idRow.append(label("Dock id"), this.useDockIdBox, this.dockId);
		const typeRow = el("div", "nav2_row");
		typeRow.append(label("Dock type"), this.dockType);
		const poseRow = el("div", "nav2_row nav2_dock_pose");
		poseRow.append(el("span", "", "Dock pose {X"), this.pose.x, el("span", "", "Y"), this.pose.y, el("span", "", "θ"), this.pose.yaw, el("span", "", "}"));
		box.append(stagingRow, idRow, typeRow, poseRow);

		this.dockButton = el("button", "nav2_button");
		this.undockButton = el("button", "nav2_button");
		for (const b of [this.dockButton, this.undockButton])
			b.type = "button";
		this.dockButton.addEventListener("click", () => this.state === "docking" ? this.cancel() : this.dock());
		this.undockButton.addEventListener("click", () => this.state === "undocking" ? this.cancel() : this.undock());

		container.append(info, this.feedbackTable, this.note, box, this.dockButton, this.undockButton);
		this.render();
	}

	// the dock type the goal uses: "Default" leaves the list (onDockingButtonPressed)
	takeDockType() {
		this.types = dropDefault(this.types);
		if (this.types.length === 0)
			return null;
		const type = this.types.includes(this.dockType.value) ? this.dockType.value : this.types[0];
		this.render();
		this.dockType.value = type;
		return type;
	}

	dock() {
		const dockType = this.takeDockType();
		if (dockType === null)
			return this.warn("The docking server has no dock plugins.");
		const t = Date.now();
		const { goal, error } = dockGoal({
			useDockId: this.useDockId, navToStaging: this.navToStaging.checked, dockId: this.dockId.value,
			x: this.pose.x.value, y: this.pose.y.value, yaw: this.pose.yaw.value, dockType,
		}, { sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1e6 });
		if (error)
			return this.warn(error);
		this.run("docking", "/dock_robot", "nav2_msgs/action/DockRobot", goal);
	}

	undock() {
		const dockType = this.takeDockType();
		if (dockType === null)
			return this.warn("The docking server has no dock plugins.");
		this.run("undocking", "/undock_robot", "nav2_msgs/action/UndockRobot", undockGoal(dockType));
	}

	run(state, name, type, goal) {
		this.note.textContent = "";
		const handle = this.ctx.action(name, type).send(goal, {
			onFeedback: (fb) => {
				this.feedback = dockFeedbackRows(fb);
				this.render();
			},
		});
		this.goal = handle;
		this.state = state;
		this.result = "";
		this.render();
		handle.result.then(({ values, ok }) => {
			if (this.goal !== handle)
				return;
			this.goal = null;
			this.state = "idle";
			if (ok)
				this.result = dockResultLabel(values);
			else
				this.warn(`${name}: ${values}`);
			this.render();
		});
	}

	cancel() {
		this.goal?.cancel();
	}

	warn(text) {
		this.note.textContent = text;
		this.status.warn(text);
	}

	render() {
		if (!this.dockButton)
			return;
		const ui = DOCK_STATES[this.state];
		for (const [button, [text, enabled, tooltip]] of [[this.dockButton, ui.dock], [this.undockButton, ui.undock]]) {
			button.textContent = text;
			button.disabled = !enabled;
			button.title = tooltip ?? "";
		}
		const on = inputsEnabled(this.state, this.useDockId, this.poseTouched);
		this.navToStaging.disabled = !on.nav_to_staging;
		this.useDockIdBox.disabled = !on.use_dock_id;
		this.dockType.disabled = !on.dock_type;
		this.dockId.disabled = !on.dock_id;
		for (const input of Object.values(this.pose))
			input.disabled = !on.pose;
		const current = this.dockType.value;
		if ([...this.dockType.options].map((o) => o.value).join("\n") !== this.types.join("\n"))
			this.dockType.replaceChildren(...this.types.map((name) => new Option(name, name)));
		if (this.types.includes(current))
			this.dockType.value = current;

		const status = el("tr");
		const title = el("td", "nav2_label", `${this.goalStatus.title}:`);
		title.style.fontWeight = "bold";
		const value = el("td", "", this.goalStatus.text);
		if (this.goalStatus.color)
			value.style.color = COLORS[this.goalStatus.color];
		status.append(title, value);
		this.statusTable.replaceChildren(status);
		this.resultLabel.textContent = this.result;
		this.feedbackTable.replaceChildren(...this.feedback.map(([label, text]) => {
			const tr = el("tr");
			tr.append(el("td", "nav2_label", label), el("td", "", text));
			return tr;
		}));
	}
}
