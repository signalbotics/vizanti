// The Navigation 2 panel (nav2_rviz_plugins/Navigation 2) for Vizanti: the same controls, states
// and behaviour as the RViz panel (see ../nav2_panel_logic.js), laid out the same way.
import { PanelPlugin, WIDGET_PROPERTIES } from '@vizanti/plugin_api.js';
import { Nav2PanelController, quaternionToYaw } from '../nav2_panel_logic.js';
import { nav2Bus } from '../nav2_bus.js';
import { managersFrom, managerNodes, ntpPosesIsArray } from '../nav2_compat.js';

// the panel's styles, loaded once
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

export class Navigation2Panel extends PanelPlugin {

	static properties = {
		manager: { type: "string", label: "Lifecycle manager", default: "", help: "The Nav2 lifecycle manager node to talk to. Empty: found on the graph (lifecycle_manager_nav2, or lifecycle_manager_navigation and lifecycle_manager_localization as on Humble and Jazzy)." },
		base_frame: { type: "frame", label: "Base frame", default: "base_footprint", noDefault: true, help: "Used by \"Store initial_pose\"." },
		...WIDGET_PROPERTIES,
	};

	onCreate() {
		const ctx = this.ctx;
		this.controller = new Nav2PanelController({
			action: (name, type) => ctx.action(name, type),
			callService: (name, type, request, timeout) => ctx.callService(name, type, request, timeout),
			publishMarkers: (array) => ctx.publish("/waypoints", "visualization_msgs/msg/MarkerArray", array, { latched: true }),
			lookupBasePose: (frame) => {
				const tf = ctx.tf;
				if (!tf.absoluteTransforms[this.props.base_frame])
					return null;
				const pose = tf.transformPose(this.props.base_frame, frame, { x: 0, y: 0, z: 0 }, new Quaternion());
				const r = pose.rotation;
				return { ...pose.translation, orientation: { x: r.x, y: r.y, z: r.z, w: r.w } };
			},
			now: () => {
				const t = Date.now();
				return { sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1e6 };
			},
			managers: async () => managersFrom(this.props.manager, managerNodes(await ctx.listServices("nav2_msgs/srv/ManageLifecycleNodes"))),
			ntpPosesIsArray: () => ntpPosesIsArray(ctx),
			baseFrame: () => this.props.base_frame,
			notify: (text) => this.status.warn(text),
		}, (snapshot) => this.render(snapshot));
		this.onGoal = (event) => {
			event.preventDefault(); // this panel takes it
			this.controller.newGoal(event.detail);
		};
		nav2Bus.addEventListener("goal", this.onGoal);
		this.status.ok("Waiting for the Nav2 lifecycle manager…");
		this.controller.start();
	}

	onPropertyChange(key) {
		if (key === "manager")
			this.controller.managers = []; // looked up again before the next command
		if (key === "manager" && this.controller.state === "pre_initial") {
			this.controller.stop();
			this.controller.start();
		}
	}

	onDestroy() {
		this.controller.stop();
		nav2Bus.removeEventListener("goal", this.onGoal);
	}

	buildPanel(container) {
		container.classList.add("nav2_panel");
		const top = el("div", "nav2_top");
		this.statusTable = el("table", "nav2_status");
		const logo = el("img", "nav2_logo");
		logo.src = new URL("../nav2_logo.svg", import.meta.url).href;
		logo.alt = "Nav2";
		top.append(this.statusTable, logo);
		this.feedbackTable = el("table", "nav2_feedback");
		this.note = el("p", "nav2_note");

		const btRow = el("div", "nav2_row");
		this.bt = el("input");
		this.bt.placeholder = "Leave empty for default behavior tree";
		this.bt.addEventListener("change", () => { this.controller.bt = this.bt.value; });
		btRow.append(el("label", "", "Behavior Tree XML:"), this.bt);

		this.buttons = {};
		const button = (key, onClick) => {
			const b = el("button", "nav2_button");
			b.type = "button";
			b.addEventListener("click", onClick ?? (() => this.controller.press(key)));
			this.buttons[key] = b;
			return b;
		};

		// tabs: NavigateToPose | NavigateThroughPoses / Waypoint Following
		this.tabButtons = { navToPose: el("button", "nav2_tab", "NavigateToPose"), waypoints: el("button", "nav2_tab", "NavigateThroughPoses / Waypoint Following") };
		const tabBar = el("div", "nav2_tabbar");
		for (const [key, b] of Object.entries(this.tabButtons)) {
			b.type = "button";
			b.addEventListener("click", () => {
				if (!b.disabled) {
					this.controller.tabs.current = key;
					this.render(this.controller.snapshot());
				}
			});
			tabBar.appendChild(b);
		}
		this.navToPoseTab = this.buildNavToPose(button);
		this.waypointTab = this.buildWaypoints(button);
		container.append(top, this.feedbackTable, this.note, btRow,
			button("pause_resume"), button("start_reset"), button("nav_mode"),
			tabBar, this.navToPoseTab, this.waypointTab);
		this.render(this.controller.snapshot());
	}

	buildNavToPose(button) {
		const tab = el("div", "nav2_tabpage");
		const grid = el("div", "nav2_grid");
		this.navFields = {};
		for (const [key, label, step, min, max] of [["frame", "Frame ID:"], ["x", "Position X:", 0.1, -1000, 1000], ["y", "Position Y:", 0.1, -1000, 1000], ["yaw", "Yaw (radians):", 0.01, -Math.PI, Math.PI]]) {
			const input = el("input");
			if (key === "frame") {
				input.type = "text";
			} else {
				input.type = "number";
				Object.assign(input, { step, min, max });
			}
			input.addEventListener("change", () => {
				this.controller.navToPose[key] = key === "frame" ? input.value : Number(input.value) || 0;
			});
			this.navFields[key] = input;
			grid.append(el("label", "", label), input);
		}
		tab.append(grid, button("start_nav_to_pose", () => this.controller.sendNavToPose()));
		return tab;
	}

	buildWaypoints(button) {
		const tab = el("div", "nav2_tabpage");
		this.poseTabs = el("div", "nav2_tabbar nav2_posetabs");
		this.poseEditor = el("div", "nav2_grid");
		this.currentPose = 0;
		const poseButtons = el("div", "nav2_row");
		poseButtons.append(button("add_pose", () => { this.controller.addPose(); this.currentPose = this.controller.accumulated.length - 1; this.render(this.controller.snapshot()); }),
			button("remove_pose", () => this.controller.removePose(this.currentPose)));
		const fileButtons = el("div", "nav2_row");
		fileButtons.append(button("save", () => this.save()), button("load", () => this.load()));
		const loopRow = el("div", "nav2_row");
		this.loops = el("input");
		this.loops.addEventListener("change", () => this.controller.setLoops(this.loops.value));
		const store = el("label", "nav2_check");
		this.storeInitial = el("input");
		this.storeInitial.type = "checkbox";
		this.storeInitial.addEventListener("change", () => { this.controller.storeInitialPose = this.storeInitial.checked; });
		store.append(this.storeInitial, " Store initial_pose");
		loopRow.append(el("label", "", "Num of loops"), this.loops, store);
		const options = el("p", "nav2_heading", "Waypoint Following Options:");
		tab.append(el("p", "", "Accumulated poses:"), this.poseTabs, this.poseEditor, poseButtons, fileButtons, options, button("pause_wp"), loopRow);
		return tab;
	}

	save() {
		const yaml = this.controller.saveWaypoints();
		if (!yaml)
			return;
		const link = el("a");
		link.href = URL.createObjectURL(new Blob([yaml], { type: "application/x-yaml" }));
		link.download = "waypoints.yaml";
		link.click();
		setTimeout(() => URL.revokeObjectURL(link.href), 1000);
	}

	load() {
		const input = el("input");
		input.type = "file";
		input.accept = ".yaml,.yml";
		input.addEventListener("change", async () => {
			const file = input.files?.[0];
			if (!file)
				return;
			const count = this.controller.loadWaypoints(await file.text());
			if (count === 0)
				this.status.warn(`${file.name} has no waypoints in the Nav2 panel's format.`);
		});
		input.click();
	}

	render(s) {
		if (!this.buttons)
			return;
		// status: "Navigation: active" and the goal status
		const navColor = s.navigation === "active" ? "green" : null;
		const rows = [this.row("Navigation:", s.navigation, navColor, true)];
		if (s.localization !== null)
			rows.push(this.row("Localization:", s.localization, s.localization === "active" ? "green" : null, true));
		rows.push(this.row(`${s.goalStatus.title}:`, s.goalStatus.text, s.goalStatus.color, true));
		this.statusTable.replaceChildren(...rows);
		this.feedbackTable.replaceChildren(...s.feedback.map(([label, value]) => this.row(label, value)));
		this.note.textContent = s.waypointNote ? `Note: ${s.waypointNote}` : "";
		this.note.hidden = !s.waypointNote;
		if (document.activeElement !== this.bt)
			this.bt.value = s.bt;
		for (const key of ["start_reset", "pause_resume", "nav_mode", "pause_wp"]) {
			const spec = s.ui[key];
			this.buttons[key].textContent = spec.text;
			this.buttons[key].disabled = !spec.enabled;
			this.buttons[key].title = spec.tip ?? "";
			this.buttons[key].hidden = spec.text === "";
		}
		this.buttons.start_nav_to_pose.textContent = "Start NavigateToPose";
		this.buttons.start_nav_to_pose.disabled = s.ui.start_nav_to_pose === false || s.ui.start_nav_to_pose === null && s.state !== "idle";
		const labels = { add_pose: "Add Pose", remove_pose: "Remove Pose", save: "Save", load: "Load" };
		for (const [key, text] of Object.entries(labels)) {
			this.buttons[key].textContent = text;
			this.buttons[key].disabled = !s.ui[key];
		}
		if (document.activeElement !== this.loops)
			this.loops.value = s.ui.loops.text;
		this.loops.disabled = !s.ui.loops.enabled;
		this.storeInitial.checked = s.storeInitialPose;
		this.storeInitial.disabled = !s.ui.store_initial;
		// tabs
		this.tabButtons.navToPose.disabled = !s.tabs.navToPose;
		this.tabButtons.waypoints.disabled = !s.tabs.waypoints;
		for (const [key, b] of Object.entries(this.tabButtons))
			b.classList.toggle("active", s.tabs.current === key);
		this.navToPoseTab.hidden = s.tabs.current !== "navToPose";
		this.waypointTab.hidden = s.tabs.current !== "waypoints";
		for (const [key, input] of Object.entries(this.navFields)) {
			if (document.activeElement !== input)
				input.value = key === "frame" ? s.navToPose.frame : s.navToPose[key];
		}
		this.renderPoses(s);
		if (s.navigation === "active")
			this.status.ok(`Navigation active (${s.state.replace(/_/g, " ")})`);
		else if (s.navigation === "inactive")
			this.status.warn("Navigation inactive: press Startup.");
	}

	renderPoses(s) {
		const poses = s.accumulated;
		this.currentPose = Math.min(this.currentPose, Math.max(0, poses.length - 1));
		this.poseTabs.replaceChildren(...poses.map((_, i) => {
			const b = el("button", "nav2_tab", `Pose ${i + 1}`);
			b.type = "button";
			b.classList.toggle("active", i === this.currentPose);
			b.addEventListener("click", () => { this.currentPose = i; this.renderPoses(this.controller.snapshot()); });
			return b;
		}));
		const pose = poses[this.currentPose];
		if (!pose) {
			this.poseEditor.replaceChildren();
			return;
		}
		const editable = s.ui.add_pose;
		const field = (key, label, step, min, max) => {
			const input = el("input");
			input.type = key === "frame" ? "text" : "number";
			if (key !== "frame")
				Object.assign(input, { step, min, max });
			const value = key === "yaw" ? (pose.orientation ? quaternionToYaw(pose.orientation) : pose.yaw) : pose[key];
			input.value = key === "frame" ? value : Number(value.toFixed(key === "yaw" ? 4 : 3));
			input.disabled = !editable;
			input.addEventListener("change", () => this.controller.editPose(this.currentPose, key, key === "frame" ? input.value : Number(input.value) || 0));
			return [el("label", "", label), input];
		};
		this.poseEditor.replaceChildren(...field("frame", "Frame ID:"), ...field("x", "Position X:", 0.1, -1000, 1000),
			...field("y", "Position Y:", 0.1, -1000, 1000), ...field("yaw", "Yaw (radians):", 0.01, -Math.PI, Math.PI));
	}

	row(label, value, color = null, bold = false) {
		const tr = el("tr");
		const th = el("td", "nav2_label", label);
		if (bold)
			th.style.fontWeight = "bold";
		const td = el("td", "", value);
		if (color)
			td.style.color = color === "green" ? "#3ecf6e" : color === "orange" ? "#f5a623" : "#ff6b6b";
		tr.append(th, td);
		return tr;
	}
}
