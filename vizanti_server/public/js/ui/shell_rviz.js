import { buildItemEditor } from './item_editor.js';
import { buildGlobalOptions, buildCameraControls, buildToolControls } from './global_controls.js';
import { TOOLS } from '../core/tools.js';
import { openAddDialog } from './add_dialog.js';
import { AppMenu, openContextMenu } from './app_menu.js';
import { dropIndex } from './reorder.js';
import { summarizeStatus, renderRate } from '../core/status_summary.js';
import { rosbridge } from '../modules/rosbridge.js';
import { tf } from '../modules/tf.js';

const dockview = globalThis["dockview-core"];

const PANELS = {
	view: { title: "3D View" },
	displays: { title: "Displays", position: { referencePanel: "view", direction: "left" }, initialWidth: 340 },
	views: { title: "Views", position: { referencePanel: "displays", direction: "below" }, initialHeight: 220 },
	time: { title: "Time", position: { referencePanel: "view", direction: "below" }, initialHeight: 64 },
};

function button(text, onClick) {
	const element = document.createElement("button");
	element.textContent = text;
	element.addEventListener("click", onClick);
	return element;
}

// A toolbar button showing one of the assets/toolbar icons, drawn in the button's text colour
// (a CSS mask), with its name as tooltip and accessible label.
function iconButton(icon, label, tooltip, onClick) {
	const element = document.createElement("button");
	element.className = "toolbar_icon_button";
	element.title = tooltip;
	element.setAttribute("aria-label", label);
	const glyph = document.createElement("span");
	glyph.className = "toolbar_icon";
	const url = `url("assets/toolbar/${icon}.svg")`;
	glyph.style.setProperty("-webkit-mask-image", url);
	glyph.style.setProperty("mask-image", url);
	element.appendChild(glyph);
	element.addEventListener("click", onClick);
	return element;
}

// The desktop UI: a toolbar, the 3D view and dockable panels, with the Displays tree
// generated from each display's property declaration.
export class RvizShell {

	constructor(app) {
		this.app = app;
		this.handlers = [];
		this.editors = [];
		this.tree = null;
		this.api = null;
		this.displayHosts = new Map(); // display panel id -> its content element
	}

	listen(name, fn) {
		this.app.registry.addEventListener(name, fn);
		this.handlers.push([name, fn]);
	}

	mount(root) {
		this.root = root;
		const registry = this.app.registry;

		const shell = document.createElement("div");
		shell.className = "rviz_shell";
		const toolbar = document.createElement("div");
		toolbar.className = "rviz_toolbar";
		const dock = document.createElement("div");
		dock.className = "rviz_dock";
		const statusBar = this.buildStatusBar();
		shell.append(toolbar, dock, statusBar);
		root.appendChild(shell);

		const menuButton = iconButton("menu", "Main menu", "Menu: import, export, robot configs, screenshot, reset", () => this.menu.toggle());
		menuButton.setAttribute("aria-haspopup", "menu");
		menuButton.setAttribute("aria-expanded", "false");
		this.menu = new AppMenu(this.app, menuButton);
		toolbar.appendChild(menuButton);
		toolbar.appendChild(iconButton("add", "Add display", "Add display", () => openAddDialog(this.app)));
		toolbar.appendChild(Object.assign(document.createElement("span"), { className: "toolbar_separator" }));
		// the pointer tools; the lit one is active
		this.toolButtons = [];
		for (const tool of TOOLS) {
			const element = iconButton(tool.id, tool.label, `${tool.label} (${tool.key.toUpperCase()}): ${tool.hint}`,
				() => this.app.tools.select(tool.id));
			element.dataset.tool = tool.id;
			toolbar.appendChild(element);
			this.toolButtons.push(element);
		}
		this.paintTools = () => {
			for (const element of this.toolButtons)
			{
				const active = element.dataset.tool === this.app.tools.active;
				element.classList.toggle("tool_active", active);
				element.setAttribute("aria-pressed", String(active));
			}
		};
		window.addEventListener("vizanti_tool_changed", this.paintTools);
		this.paintTools();

		const spacer = document.createElement("span");
		spacer.className = "spacer_flex";
		toolbar.appendChild(spacer);

		// widgets that run from their original template keep their own live icon; it goes here
		this.widgets = document.createElement("div");
		this.widgets.className = "rviz_widgets";
		toolbar.insertBefore(this.widgets, spacer);

		// some template widgets measure the old icon bar; it has no height in this shell
		const bar = document.createElement("div");
		bar.id = "icon_bar";
		bar.style.display = "none";
		shell.appendChild(bar);

		// each panel has a toggle: lit while the panel is open, click to close or bring it back
		this.panelButtons = {};
		for (const id of Object.keys(PANELS)) {
			this.panelButtons[id] = iconButton(id, `${PANELS[id].title} panel`, `${PANELS[id].title} panel: click to show or hide`,
				() => this.togglePanel(id));
			this.panelButtons[id].classList.add("panel_toggle");
			toolbar.appendChild(this.panelButtons[id]);
		}
		toolbar.appendChild(Object.assign(document.createElement("span"), { className: "toolbar_separator" }));
		toolbar.appendChild(iconButton("touch", "Switch to Touch UI", "Switch to the touch UI (phones and tablets)",
			() => this.app.switchShell("touch")));

		this.api = dockview.createDockview(dock, {
			theme: dockview.themeDark,
			createComponent: (options) => this.component(options.name, options.id),
		});
		this.removeListener = this.api.onDidRemovePanel((panel) => {
			this.releaseLegacy(panel.id);
			this.releaseDisplayPanel(panel.id);
		});

		let restored = false;
		if (registry.ui.rviz_layout) {
			try {
				this.api.fromJSON(registry.ui.rviz_layout);
				restored = true;
			} catch (e) {
				console.warn("The saved panel layout could not be restored, using the default:", e);
				this.api.clear();
			}
		}
		if (!restored) {
			for (const id of Object.keys(PANELS))
				this.showPanel(id);
		}
		// dockview measures its container lazily; do it now so a restored layout has its real size
		this.api.layout(dock.clientWidth, dock.clientHeight);
		if (!restored) {
			// dockview does not apply initialWidth/initialHeight when splitting an existing group
			this.api.getPanel("displays")?.api.setSize({ width: PANELS.displays.initialWidth });
			this.api.getPanel("views")?.api.setSize({ height: PANELS.views.initialHeight });
			this.api.getPanel("time")?.api.setSize({ height: PANELS.time.initialHeight });
		}

		this.layoutListener = this.api.onDidLayoutChange(() => {
			registry.setUi("rviz_layout", this.api.toJSON());
			this.paintPanelButtons();
		});
		this.paintPanelButtons();

		for (const name of ["added", "removed", "reordered", "loaded", "enabled", "renamed"])
			this.listen(name, () => this.renderTree());
		this.renderWidgets();
		this.listen("removed", (event) => this.api.getPanel("legacy:" + event.detail.item.id)?.api.close());
		this.listen("status", (event) => this.paintStatus(event.detail.item));
		this.listen("property", (event) => this.paintIcon(event.detail.item));
		for (const name of ["icon", "status", "property", "renamed", "enabled"])
			this.listen(name, (event) => event.detail?.item && this.paintWidget(event.detail.item));
		this.listen("icon", (event) => this.paintIcon(event.detail.item));

		// displays that show in a panel of their own (an image with "Show in: its own panel")
		for (const name of ["added", "removed", "property", "enabled", "loaded", "renamed"])
			this.listen(name, () => this.syncDisplayPanels());
		this.syncDisplayPanels();
	}

	unmount() {
		window.removeEventListener("vizanti_tool_changed", this.paintTools);
		clearInterval(this.timeTimer);
		clearInterval(this.statusTimer);
		if (this.toolPanelPaint)
			window.removeEventListener("vizanti_tool_changed", this.toolPanelPaint);
		for (const [name, fn] of this.handlers)
			this.app.registry.removeEventListener(name, fn);
		this.handlers = [];
		for (const editor of this.editors)
			editor.dispose();
		this.editors = [];
		this.tree = null;
		this.menu?.close();

		// displays shown in their own panel go back to their overlay
		for (const item of this.app.registry.items) {
			if (item.panelHost && typeof item.detachPanel === "function")
				item.detachPanel();
		}

		// template widgets keep their icon and modal elements across shells
		if (this.legacyObserver)
			this.legacyObserver.disconnect();
		for (const item of this.app.registry.items) {
			if (item.iconElement)
				this.app.legacy.icons.appendChild(item.iconElement);
			this.releaseLegacy("legacy:" + item.id);
		}

		this.app.sceneElement.remove();
		this.removeListener.dispose();
		this.layoutListener.dispose();
		this.api.dispose();
		this.api = null;
		this.root.replaceChildren();
	}

	togglePanel(id) {
		const panel = this.api.getPanel(id);
		if (panel)
			panel.api.close();
		else
			this.showPanel(id);
		this.paintPanelButtons();
	}

	paintPanelButtons() {
		for (const [id, element] of Object.entries(this.panelButtons)) {
			const open = !!this.api.getPanel(id);
			element.classList.toggle("panel_open", open);
			element.setAttribute("aria-pressed", String(open));
			element.title = open ? `Hide the ${PANELS[id].title} panel` : `Show the ${PANELS[id].title} panel`;
		}
	}

	showPanel(id) {
		if (this.api.getPanel(id))
			return;
		const spec = { id, component: id, title: PANELS[id].title };
		// place it relative to its usual neighbour when that neighbour is open
		if (PANELS[id].position && this.api.getPanel(PANELS[id].position.referencePanel)) {
			spec.position = PANELS[id].position;
			if (PANELS[id].initialWidth) spec.initialWidth = PANELS[id].initialWidth;
			if (PANELS[id].initialHeight) spec.initialHeight = PANELS[id].initialHeight;
		}
		this.api.addPanel(spec);
	}

	// ROS time, wall time and time since the page opened, as in RViz's Time panel
	buildTime(element) {
		element.classList.add("rviz_time");
		const field = (label) => {
			const box = document.createElement("span");
			const name = document.createElement("label");
			name.textContent = label + ": ";
			const value = document.createElement("span");
			value.className = "time_value";
			box.append(name, value);
			element.appendChild(box);
			return value;
		};
		const ros = field("ROS Time"), elapsed = field("ROS Elapsed"), wall = field("Wall Time"), source = field("Source");
		const time = this.app.time;
		const started = time.now();
		clearInterval(this.timeTimer);
		this.timeTimer = setInterval(() => {
			if (!element.isConnected)
				return;
			ros.textContent = time.now().toFixed(2);
			elapsed.textContent = (time.now() - started).toFixed(2);
			wall.textContent = (Date.now() / 1000).toFixed(2);
			source.textContent = time.simulated ? "/clock (simulation)" : "system clock";
		}, 100);
	}

	// ---- panels for widgets that run from their original template ----

	// ---- displays with a panel of their own ----

	// Opens a panel for each enabled display that wants one, and closes the rest.
	syncDisplayPanels() {
		if (!this.api)
			return;
		const wanted = new Map();
		for (const item of this.app.registry.items) {
			if (item.enabled && item.wantsPanel && typeof item.attachPanel === "function")
				wanted.set("display:" + item.id, item);
		}
		this.closingDisplayPanels = true;
		try {
			for (const panel of [...this.api.panels]) {
				if (panel.id.startsWith("display:") && !wanted.has(panel.id))
					panel.api.close();
			}
		} finally {
			this.closingDisplayPanels = false;
		}
		for (const [panelId, item] of wanted) {
			const existing = this.api.getPanel(panelId);
			if (existing) {
				if (existing.title !== item.name)
					existing.api.setTitle(item.name);
				const host = this.displayHosts.get(panelId);
				if (!item.panelHost && host)
					item.attachPanel(host);
				continue;
			}
			// beside another display panel as a tab, or to the right of the 3D view
			const sibling = this.api.panels.find((panel) => panel.id.startsWith("display:"));
			const position = sibling ? { referencePanel: sibling.id }
				: (this.api.getPanel("view") ? { referencePanel: "view", direction: "right" } : undefined);
			this.api.addPanel({ id: panelId, component: "display", title: item.name, position });
			if (!sibling)
				this.api.getPanel(panelId)?.api.setSize({ width: 420 });
		}
	}

	// A display panel went away: the display shows in its overlay again. Closed by the user
	// (not by syncDisplayPanels), it also disables the display, as the panel belongs to it.
	releaseDisplayPanel(panelId) {
		if (!panelId.startsWith("display:"))
			return;
		this.displayHosts.delete(panelId);
		const item = this.app.registry.get(panelId.slice("display:".length));
		if (!item)
			return;
		if (typeof item.detachPanel === "function" && item.panelHost)
			item.detachPanel();
		if (!this.closingDisplayPanels && item.enabled && item.wantsPanel) {
			if (item.constructor.widget)
				item.togglePanel(false); // a widget's panel just closes
			else
				this.app.registry.setEnabled(item.id, false); // an image panel belongs to the display
		}
	}

	openLegacy(id) {
		const item = this.app.registry.get(id);
		if (!item || !item.modalElement)
			return;
		const panelId = "legacy:" + id;
		const existing = this.api.getPanel(panelId);
		if (existing) {
			existing.api.setActive();
			item.modalElement.style.display = "flex";
			return;
		}
		// open beside another widget panel as a tab, or to the right of the 3D view
		const sibling = this.api.panels.find((panel) => panel.id.startsWith("legacy:"));
		const position = sibling ? { referencePanel: sibling.id }
			: (this.api.getPanel("view") ? { referencePanel: "view", direction: "right" } : undefined);
		this.api.addPanel({ id: panelId, component: "legacy", title: item.name, position });
		if (!sibling)
			this.api.getPanel(panelId)?.api.setSize({ width: 420 });
	}

	// puts a widget's modal back where it lives when its panel goes away
	releaseLegacy(panelId) {
		if (!panelId.startsWith("legacy:"))
			return;
		const item = this.app.registry.get(panelId.slice("legacy:".length));
		if (item && item.modalElement && item.modalHolder && item.modalElement.parentElement !== item.modalHolder) {
			item.modalElement.style.display = "none";
			item.modalHolder.appendChild(item.modalElement);
		}
	}

	attachLegacy(element, panelId) {
		const item = this.app.registry.get(panelId.slice("legacy:".length));
		if (!item || !item.modalElement) {
			// a saved layout can name a widget that no longer exists
			setTimeout(() => this.api?.getPanel(panelId)?.api.close(), 0);
			return;
		}
		element.appendChild(item.modalElement);
		item.modalElement.style.display = "flex";

		// the widget's own scripts close their modal by hiding it; close the panel with it
		if (!this.legacyObserver) {
			this.legacyObserver = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					const modal = mutation.target;
					if (modal.style.display === "none" && modal.closest(".rviz_panel_legacy")) {
						const id = modal.id.replace(/_modal$/, "");
						this.api?.getPanel("legacy:" + id)?.api.close();
					}
				}
			});
		}
		this.legacyObserver.observe(item.modalElement, { attributes: true, attributeFilter: ["style"] });
	}

	component(name, id) {
		const element = document.createElement("div");
		element.className = "rviz_panel rviz_panel_" + name;
		return {
			element,
			init: () => {
				if (name === "legacy") {
					this.attachLegacy(element, id);
				} else if (name === "display") {
					element.classList.add("display_panel_host");
					this.displayHosts.set(id, element);
					const item = this.app.registry.get(id.slice("display:".length));
					if (item && typeof item.attachPanel === "function")
						item.attachPanel(element);
				} else if (name === "view") {
					element.appendChild(this.app.sceneElement);
				} else if (name === "displays") {
					this.tree = document.createElement("div");
					this.tree.className = "display_tree";
					this.tree.tabIndex = -1;
					this.tree.addEventListener("keydown", (event) => this.treeKey(event));
					this.actionRow = this.buildActionRow();
					element.append(this.tree, this.actionRow);
					this.renderTree();
				} else if (name === "time") {
					this.buildTime(element);
				} else if (name === "views") {
					buildCameraControls(element, this.app);
					const heading = document.createElement("h4");
					heading.textContent = "Tool topics";
					element.appendChild(heading);
					const paint = buildToolControls(element, this.app);
					window.addEventListener("vizanti_tool_changed", paint);
					this.toolPanelPaint = paint;
				}
			},
		};
	}

	renderWidgets() {
		this.widgetButtons ??= new Map();
		const seen = new Set();
		for (const item of this.app.registry.items) {
			if (item.iconElement && item.constructor.type !== "folder" && item.iconElement.parentElement !== this.widgets)
				this.widgets.appendChild(item.iconElement);
			if (!item.constructor.widget)
				continue;
			// a native widget: its live icon opens and closes its panel
			seen.add(item.id);
			let element = this.widgetButtons.get(item.id);
			if (!element) {
				element = document.createElement("button");
				element.type = "button";
				element.className = "widget_button";
				element.appendChild(item.makeIconFace() ?? document.createElement("img"));
				// an action widget (Button) acts on a click and opens its panel on a right-click; a
				// right-click does a widget's long-press action (Teleop's lock) where it has one
				element.addEventListener("click", () => (item.onIconClick ? item.onIconClick() : item.togglePanel()));
				element.addEventListener("contextmenu", (event) => {
					event.preventDefault();
					if (item.onIconLongPress)
						item.onIconLongPress();
					else
						item.togglePanel();
				});
				this.widgetButtons.set(item.id, element);
			}
			this.widgets.appendChild(element); // keeps the display order
			this.paintWidget(item);
		}
		for (const [id, element] of this.widgetButtons) {
			if (!seen.has(id)) {
				element.remove();
				this.widgetButtons.delete(id);
			}
		}
	}

	paintWidget(item) {
		const element = this.widgetButtons?.get(item.id);
		if (!element)
			return;
		const image = element.firstElementChild;
		if (image.tagName === "IMG") {
			if (image.getAttribute("src") !== item.icon)
				image.src = item.icon;
			image.alt = "";
		}
		element.title = `${item.name}: ${item.status.text}` + (item.onIconClick ? " (right-click for its panel)" : item.onIconLongPress ? ` (right-click: ${item.longPressHint ?? "more"})` : item.wantsPanel ? "" : " (click to open)");
		element.setAttribute("aria-label", item.name);
		element.setAttribute("aria-pressed", String(!!item.wantsPanel));
		element.classList.toggle("widget_open", !!item.wantsPanel);
		element.classList.toggle("widget_disabled", !item.enabled);
		element.classList.toggle("status-warn", item.status.level === "warn");
		element.classList.toggle("status-error", item.status.level === "error");
	}

	renderTree() {
		this.renderWidgets();
		if (!this.tree)
			return;

		const registry = this.app.registry;
		const open = new Set([...this.tree.querySelectorAll("details[open]")].map((d) => d.dataset.id));
		const firstRender = this.tree.children.length === 0;

		for (const editor of this.editors)
			editor.dispose();
		this.editors = [];
		this.tree.replaceChildren();

		const global = document.createElement("details");
		global.className = "tree_item";
		global.dataset.id = "__global";
		global.open = firstRender || open.has("__global");
		const globalSummary = document.createElement("summary");
		globalSummary.textContent = "Global Options";
		const globalBody = document.createElement("div");
		globalBody.className = "tree_body";
		buildGlobalOptions(globalBody, this.app);
		global.append(globalSummary, globalBody);
		this.tree.appendChild(global);

		registry.items.forEach((item) => {
			const details = document.createElement("details");
			details.className = "tree_item";
			details.dataset.id = item.id;
			details.open = open.has(item.id);

			const summary = document.createElement("summary");
			const enabled = document.createElement("input");
			enabled.type = "checkbox";
			enabled.checked = item.enabled;
			enabled.addEventListener("click", (event) => event.stopPropagation());
			enabled.addEventListener("change", () => registry.setEnabled(item.id, enabled.checked));
			const icon = document.createElement("img");
			icon.src = item.icon;
			icon.alt = "";
			const name = document.createElement("span");
			name.className = "tree_name";
			name.textContent = item.name;
			const status = document.createElement("span");
			status.className = "tree_status";
			summary.append(enabled, icon, name, status);
			summary.addEventListener("click", () => this.select(item.id));
			summary.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				this.select(item.id);
				this.openItemMenu(item, event.clientX, event.clientY);
			});
			details.classList.toggle("tree_selected", item.id === this.selectedId);
			this.makeDraggable(details, summary, item);

			const body = document.createElement("div");
			body.className = "tree_body";
			if (item.constructor.kind === "template") {
				// its settings live in its own panel
				if (item.modalElement)
					body.appendChild(button("Open panel", () => this.openLegacy(item.id)));
			} else {
				const editor = buildItemEditor(item, this.app);
				this.editors.push(editor);
				body.appendChild(editor.element);
			}

			details.append(summary, body);
			this.tree.appendChild(details);
			this.paintStatus(item);
		});
		if (this.selectedId && !registry.get(this.selectedId))
			this.selectedId = null; // it was removed
		this.paintActionRow();
	}

	// ---- status bar: connection, fixed frame, display problems, tool, render rate ----

	buildStatusBar() {
		const bar = document.createElement("div");
		bar.className = "rviz_statusbar";
		bar.setAttribute("role", "status");
		const segment = (className, tag = "span") => {
			const element = document.createElement(tag);
			element.className = "status_segment " + className;
			bar.appendChild(element);
			return element;
		};
		const connection = segment("status_connection");
		const frame = segment("status_frame");
		const displays = segment("status_displays", "button");
		displays.title = "Show the first display with a problem";
		displays.addEventListener("click", () => this.revealProblem());
		const spacer = document.createElement("span");
		spacer.className = "spacer_flex";
		bar.appendChild(spacer);
		const tool = segment("status_tool");
		const rate = segment("status_rate");
		rate.title = "Redraws per second (the view only redraws when something changes) and the time the last one took";

		const paint = (element, { level, text }) => {
			element.textContent = text;
			element.dataset.level = level;
		};
		let last = { frames: this.app.scene.stats.frames, time: performance.now() };
		const update = () => {
			const summary = summarizeStatus(
				{ connected: rosbridge.connected, status: rosbridge.status, url: `${rosbridge.url}:${rosbridge.port}` },
				tf.fixed_frame, tf.frame_list, this.app.registry.items);
			paint(connection, summary.connection);
			paint(frame, summary.frame);
			paint(displays, summary.displays);
			displays.disabled = summary.displays.firstProblemId === null;
			this.firstProblemId = summary.displays.firstProblemId;

			const label = this.app.tools ? TOOLS.find((t) => t.id === this.app.tools.active)?.label : "";
			tool.textContent = label ? `Tool: ${label}` : "";

			const now = performance.now();
			const stats = this.app.scene.stats;
			const fps = renderRate(stats.frames - last.frames, now - last.time);
			last = { frames: stats.frames, time: now };
			rate.textContent = fps === 0 ? "Idle" : `${fps} fps · ${stats.lastMs.toFixed(1)} ms`;
		};
		update();
		clearInterval(this.statusTimer);
		this.statusTimer = setInterval(update, 500);
		return bar;
	}

	// Selects the first display with an error (or else a warning), opens it and scrolls to it.
	revealProblem() {
		const item = this.firstProblemId ? this.app.registry.get(this.firstProblemId) : null;
		if (!item)
			return;
		if (this.api && !this.api.getPanel("displays"))
			this.showPanel("displays");
		this.select(item.id);
		const row = this.row(item);
		if (row) {
			row.open = true;
			row.scrollIntoView({ block: "nearest" });
		}
	}

	// ---- drag a display's row up or down the list ----

	makeDraggable(details, summary, item) {
		const DRAG_TYPE = "application/x-vizanti-display";
		summary.draggable = true;
		summary.addEventListener("dragstart", (event) => {
			this.draggingId = item.id;
			event.dataTransfer.setData(DRAG_TYPE, item.id);
			event.dataTransfer.effectAllowed = "move";
			details.classList.add("tree_dragging");
		});
		summary.addEventListener("dragend", () => {
			this.draggingId = null;
			details.classList.remove("tree_dragging");
			for (const row of this.tree?.querySelectorAll(".drop_before, .drop_after") ?? [])
				row.classList.remove("drop_before", "drop_after");
		});
		const below = (event) => {
			const rect = summary.getBoundingClientRect();
			return event.clientY > rect.top + rect.height / 2;
		};
		details.addEventListener("dragover", (event) => {
			if (!this.draggingId || this.draggingId === item.id)
				return;
			event.preventDefault(); // accept the drop
			event.dataTransfer.dropEffect = "move";
			const after = below(event);
			details.classList.toggle("drop_before", !after);
			details.classList.toggle("drop_after", after);
		});
		details.addEventListener("dragleave", (event) => {
			if (!details.contains(event.relatedTarget))
				details.classList.remove("drop_before", "drop_after");
		});
		details.addEventListener("drop", (event) => {
			const id = this.draggingId;
			if (!id || id === item.id)
				return;
			event.preventDefault();
			const items = this.app.registry.items;
			const to = dropIndex(items.findIndex((i) => i.id === id), items.indexOf(item), below(event));
			this.app.registry.move(id, to);
			this.select(id);
		});
	}

	// ---- the selected display, its action row and right-click menu ----

	selected() {
		return this.selectedId ? this.app.registry.get(this.selectedId) ?? null : null;
	}

	select(id) {
		this.selectedId = id;
		if (this.tree) {
			for (const child of this.tree.children)
				child.classList.toggle("tree_selected", child.dataset.id === id);
		}
		this.paintActionRow();
	}

	buildActionRow() {
		const row = document.createElement("div");
		row.className = "display_actions";
		const make = (icon, label, hint, onClick) => {
			const element = iconButton(icon, label, hint, onClick);
			row.appendChild(element);
			return element;
		};
		const withSelected = (fn) => () => {
			const item = this.selected();
			if (item)
				fn(item);
		};
		this.actionButtons = {
			add: make("add", "Add display", "Add a display", () => openAddDialog(this.app)),
			duplicate: make("duplicate", "Duplicate", "Duplicate: add a copy of the selected display", withSelected((item) => this.duplicate(item))),
			rename: make("rename", "Rename", "Rename the selected display (F2)", withSelected((item) => this.startRename(item))),
			up: make("up", "Move up", "Move the selected display up", withSelected((item) => this.moveBy(item, -1))),
			down: make("down", "Move down", "Move the selected display down", withSelected((item) => this.moveBy(item, 1))),
			remove: make("remove", "Remove", "Remove the selected display (Delete)", withSelected((item) => this.app.registry.remove(item.id))),
		};
		this.actionButtons.remove.classList.add("action_danger");
		return row;
	}

	paintActionRow() {
		if (!this.actionButtons)
			return;
		const item = this.selected();
		const index = item ? this.app.registry.items.indexOf(item) : -1;
		this.actionButtons.duplicate.disabled = !item || item.constructor.kind === "template";
		this.actionButtons.rename.disabled = !item;
		this.actionButtons.remove.disabled = !item;
		this.actionButtons.up.disabled = !item || index <= 0;
		this.actionButtons.down.disabled = !item || index >= this.app.registry.items.length - 1;
	}

	duplicate(item) {
		if (item.constructor.kind === "template")
			return; // template widgets own page elements by id; one per widget
		const copy = this.app.registry.duplicate(item.id);
		if (copy)
			this.select(copy.id);
	}

	moveBy(item, step) {
		this.app.registry.move(item.id, this.app.registry.items.indexOf(item) + step);
	}

	openItemMenu(item, x, y) {
		const index = this.app.registry.items.indexOf(item);
		const last = this.app.registry.items.length - 1;
		openContextMenu(x, y, [
			{ label: "Rename", action: () => this.startRename(item) },
			{ label: "Duplicate", action: () => this.duplicate(item), disabled: item.constructor.kind === "template" },
			{ label: item.enabled ? "Disable" : "Enable", action: () => this.app.registry.setEnabled(item.id, !item.enabled) },
			"-",
			{ label: "Move up", action: () => this.moveBy(item, -1), disabled: index <= 0 },
			{ label: "Move down", action: () => this.moveBy(item, 1), disabled: index >= last },
			"-",
			{ label: "Remove", action: () => this.app.registry.remove(item.id), danger: true },
		]);
	}

	// Swaps the row's name for a text field: Enter or leaving the field keeps it, Escape cancels.
	startRename(item) {
		const row = this.row(item);
		const name = row?.querySelector(".tree_name");
		if (!name)
			return;
		const input = document.createElement("input");
		input.type = "text";
		input.className = "tree_rename";
		input.value = item.name;
		input.setAttribute("aria-label", "Display name");
		let done = false;
		const finish = (keep) => {
			if (done)
				return;
			done = true;
			if (!(keep && this.app.registry.rename(item.id, input.value)))
				input.replaceWith(name); // unchanged, or an empty name
		};
		// a click, space or Enter inside a <summary> would open or close the row
		input.addEventListener("click", (event) => event.preventDefault());
		input.addEventListener("keydown", (event) => {
			event.stopPropagation();
			if (event.key === "Enter") {
				event.preventDefault();
				finish(true);
			} else if (event.key === "Escape") {
				event.preventDefault();
				finish(false);
			}
		});
		input.addEventListener("keyup", (event) => event.preventDefault());
		input.addEventListener("blur", () => finish(true));
		name.replaceWith(input);
		input.focus();
		input.select();
	}

	treeKey(event) {
		const item = this.selected();
		if (!item || event.target.closest("input, select, textarea"))
			return;
		if (event.key === "F2") {
			event.preventDefault();
			this.startRename(item);
		} else if (event.key === "Delete") {
			event.preventDefault();
			this.app.registry.remove(item.id);
		}
	}

	row(item) {
		if (!this.tree)
			return null;
		return [...this.tree.children].find((child) => child.dataset.id === item.id) ?? null;
	}

	paintStatus(item) {
		const row = this.row(item);
		if (!row)
			return;
		const status = row.querySelector(".tree_status");
		status.textContent = item.status.level === "ok" ? "" : item.status.text;
		status.title = item.status.text;
		status.classList.toggle("status-warn", item.status.level === "warn");
		status.classList.toggle("status-error", item.status.level === "error");
	}

	// a property can change the icon (the map's colour scheme does)
	paintIcon(item) {
		const row = this.row(item);
		if (row)
			row.querySelector("summary img").src = item.icon;
	}
}
