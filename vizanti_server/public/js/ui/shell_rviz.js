import { buildItemEditor } from './item_editor.js';
import { buildGlobalOptions, buildCameraControls, buildLayoutControls } from './global_controls.js';
import { openAddDialog } from './add_dialog.js';

const dockview = globalThis["dockview-core"];

const PANELS = {
	view: { title: "3D View" },
	displays: { title: "Displays", position: { referencePanel: "view", direction: "left" }, initialWidth: 340 },
	views: { title: "Views", position: { referencePanel: "displays", direction: "below" }, initialHeight: 220 },
};

function button(text, onClick) {
	const element = document.createElement("button");
	element.textContent = text;
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
		shell.append(toolbar, dock);
		root.appendChild(shell);

		toolbar.appendChild(button("Add", () => openAddDialog(this.app)));
		const tool = document.createElement("span");
		tool.className = "tool_active";
		tool.textContent = "Move Camera";
		toolbar.appendChild(tool);

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
			this.panelButtons[id] = button(PANELS[id].title, () => this.togglePanel(id));
			this.panelButtons[id].classList.add("panel_toggle");
			toolbar.appendChild(this.panelButtons[id]);
		}
		toolbar.appendChild(button("Touch UI", () => this.app.switchShell("touch")));

		this.api = dockview.createDockview(dock, {
			theme: dockview.themeDark,
			createComponent: (options) => this.component(options.name, options.id),
		});
		this.removeListener = this.api.onDidRemovePanel((panel) => this.releaseLegacy(panel.id));

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
		}

		this.layoutListener = this.api.onDidLayoutChange(() => {
			registry.setUi("rviz_layout", this.api.toJSON());
			this.paintPanelButtons();
		});
		this.paintPanelButtons();

		for (const name of ["added", "removed", "reordered", "loaded", "enabled"])
			this.listen(name, () => this.renderTree());
		this.renderWidgets();
		this.listen("removed", (event) => this.api.getPanel("legacy:" + event.detail.item.id)?.api.close());
		this.listen("status", (event) => this.paintStatus(event.detail.item));
		this.listen("property", (event) => this.paintIcon(event.detail.item));
	}

	unmount() {
		for (const [name, fn] of this.handlers)
			this.app.registry.removeEventListener(name, fn);
		this.handlers = [];
		for (const editor of this.editors)
			editor.dispose();
		this.editors = [];
		this.tree = null;

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

	// ---- panels for widgets that run from their original template ----

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
				} else if (name === "view") {
					element.appendChild(this.app.sceneElement);
				} else if (name === "displays") {
					this.tree = element;
					this.renderTree();
				} else if (name === "views") {
					buildCameraControls(element, this.app);
				}
			},
		};
	}

	renderWidgets() {
		for (const item of this.app.registry.items) {
			if (item.iconElement && item.constructor.type !== "folder" && item.iconElement.parentElement !== this.widgets)
				this.widgets.appendChild(item.iconElement);
		}
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
		buildLayoutControls(globalBody, this.app);
		global.append(globalSummary, globalBody);
		this.tree.appendChild(global);

		registry.items.forEach((item, index) => {
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

			const buttons = document.createElement("div");
			buttons.className = "tree_buttons";
			buttons.append(
				button("▲", () => registry.move(item.id, index - 1)),
				button("▼", () => registry.move(item.id, index + 1)),
				button("Remove", () => registry.remove(item.id))
			);
			body.appendChild(buttons);

			details.append(summary, body);
			this.tree.appendChild(details);
			this.paintStatus(item);
		});
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
