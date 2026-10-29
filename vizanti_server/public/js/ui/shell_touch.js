import { buildItemEditor, buildGroupPicker } from './item_editor.js';
import { buildGlobalOptions, buildCameraControls, buildLayoutControls, buildToolControls } from './global_controls.js';
import { openAddDialog } from './add_dialog.js';
import { setIconColor } from '../modules/util.js';
import { memberKey } from '../core/registry.js';

const BAR_HEIGHT_KEY = "iconBarHeight";

function hr() {
	const element = document.createElement("hr");
	element.className = "dark_hr";
	return element;
}

// The icon bar UI for phones and tablets: one icon per display, a modal per icon.
// Displays get a generated icon and modal; widgets that still run from their original
// template bring their own icon element and modal.
export class TouchShell {

	constructor(app) {
		this.app = app;
		this.handlers = [];
		this.windowHandlers = [];
		this.wrappers = new Map(); // item id -> icon wrapper element
		this.modal = null;
	}

	listen(name, fn) {
		this.app.registry.addEventListener(name, fn);
		this.handlers.push([name, fn]);
	}

	listenWindow(name, fn) {
		window.addEventListener(name, fn);
		this.windowHandlers.push([name, fn]);
	}

	mount(root) {
		this.root = root;

		this.bar = document.createElement("div");
		this.bar.id = "icon_bar";
		this.icons = document.createElement("div");
		this.icons.id = "icon_container";
		const handle = document.createElement("div");
		handle.id = "icon_bar_handle";
		this.bar.append(this.icons, handle);
		this.bar.addEventListener("wheel", (event) => { this.bar.scrollLeft += event.deltaY * 0.5; });
		this.bar.addEventListener("contextmenu", (event) => event.preventDefault());
		this.setupBarDragging(handle);

		const view = document.createElement("div");
		view.id = "view_host";
		view.appendChild(this.app.sceneElement);

		this.modals = document.createElement("div");
		this.modals.id = "modal_container";

		// group member icons while their group is closed
		this.hidden = document.createElement("div");
		this.hidden.style.display = "none";

		root.append(this.bar, view, this.modals, this.hidden);

		this.settingsIcon = this.staticIcon("settingsbutton", "assets/settings.svg", "Global Settings", () => this.openSettings());
		this.addIcon = this.staticIcon("addbutton", "assets/add.svg", "Add", () => openAddDialog(this.app));
		this.icons.append(this.settingsIcon, this.addIcon, this.switchIcon());

		let saved = null;
		try { saved = window.localStorage.getItem(BAR_HEIGHT_KEY); } catch (e) { /* storage blocked */ }
		if (saved)
			this.setBarHeight(saved);

		for (const name of ["added", "removed", "reordered", "loaded", "enabled", "renamed", "grouped"])
			this.listen(name, () => this.renderIcons());
		this.listen("property", (event) => this.paintIcon(event.detail.item));
		this.listen("icon", (event) => this.paintIcon(event.detail.item)); // a widget's live icon
		this.listen("status", (event) => this.paintStatus(event.detail.item));
		this.listenWindow("resize", () => this.calculateWidth());

		this.renderIcons();
	}

	unmount() {
		for (const [name, fn] of this.handlers)
			this.app.registry.removeEventListener(name, fn);
		for (const [name, fn] of this.windowHandlers)
			window.removeEventListener(name, fn);
		this.handlers = [];
		this.windowHandlers = [];
		this.closeModal();

		// template widgets keep their icon and modal elements across shells
		for (const item of this.app.registry.items) {
			if (item.iconElement)
				this.app.legacy.icons.appendChild(item.iconElement);
			if (item.modalElement)
				item.modalElement.style.display = "none";
		}
		for (const [id, wrapper] of this.wrappers) {
			if (!this.app.registry.get(id)?.iconElement)
				wrapper.remove();
		}
		this.wrappers.clear();

		this.app.sceneElement.remove();
		this.root.replaceChildren();
	}

	// ---- icon bar ----

	staticIcon(id, src, title, onClick) {
		const wrapper = document.createElement("div");
		wrapper.dataset.uniqueid = id;
		const icon = document.createElement("div");
		icon.className = "icon noselect";
		icon.title = title;
		const image = document.createElement("img");
		image.src = src;
		image.alt = title;
		icon.appendChild(image);
		icon.addEventListener("click", onClick);
		wrapper.appendChild(icon);
		return wrapper;
	}

	// A group's icon: a folder showing its first two members' icons.
	groupIcon(item) {
		const wrapper = document.createElement("div");
		wrapper.dataset.uniqueid = item.id;
		const icon = document.createElement("div");
		icon.className = "icon noselect icon-group";
		icon.title = item.name;
		const folder = document.createElement("img");
		folder.src = item.icon;
		folder.alt = "";
		folder.className = "group_folder";
		icon.appendChild(folder);
		for (const side of ["left", "right"]) {
			const mini = document.createElement("img");
			mini.className = `group_mini group_mini_${side}`;
			mini.alt = "";
			icon.appendChild(mini);
		}
		icon.addEventListener("click", () => this.openGroup(item));
		wrapper.appendChild(icon);
		return wrapper;
	}

	paintGroup(item) {
		const icon = this.wrappers.get(item.id)?.firstElementChild;
		if (!icon)
			return;
		const members = this.app.registry.membersOf(item.id);
		icon.querySelectorAll(".group_mini").forEach((mini, i) => {
			const member = members[i];
			mini.style.display = member ? "" : "none";
			if (member && mini.getAttribute("src") !== member.icon)
				mini.src = member.icon;
		});
		icon.title = `${item.name} (${members.length})`;
	}

	// where a group's member icons live: in the group's modal while it is open, else out of sight
	groupHolder(groupId) {
		this.holders ??= new Map();
		let holder = this.holders.get(groupId);
		if (!holder) {
			holder = document.createElement("div");
			holder.className = "folder_icon_container";
			holder.appendChild(this.staticIcon("addbutton", "assets/add.svg", "Add to this group",
				() => openAddDialog(this.app, { container: memberKey(groupId) })));
			this.holders.set(groupId, holder);
			this.hidden.appendChild(holder);
		}
		return holder;
	}

	// A display's icon is an inline SVG document, so it can be tinted with the display's colour.
	displayIcon(item) {
		if (item.constructor.isGroup)
			return this.groupIcon(item);
		const wrapper = document.createElement("div");
		wrapper.dataset.uniqueid = item.id;
		const icon = document.createElement("div");
		icon.className = "icon noselect";
		icon.title = item.name;
		const face = item.makeIconFace?.();
		if (face) {
			// a widget that draws its own icon
			icon.appendChild(face);
			this.onIconPress(icon, item);
			wrapper.appendChild(icon);
			return wrapper;
		}
		const image = document.createElement("object");
		image.type = "image/svg+xml";
		image.width = 50;
		image.height = 50;
		image.style.pointerEvents = "none";
		image.addEventListener("load", () => {
			if (item.iconColor)
				setIconColor(image, item.iconColor);
		});
		image.data = item.icon;
		icon.appendChild(image);
		this.onIconPress(icon, item);
		wrapper.appendChild(icon);
		return wrapper;
	}

	// A tap opens the item's settings. An action widget (Button) acts on a tap instead and opens
	// its settings on a long press; a widget with a long-press action (Teleop's lock) does that.
	onIconPress(icon, item) {
		const tap = item.onIconClick ? () => item.onIconClick() : () => this.openItem(item);
		const hold = item.onIconLongPress ? () => item.onIconLongPress() : item.onIconClick ? () => this.openItem(item) : null;
		if (!hold) {
			icon.addEventListener("click", tap);
			return;
		}
		let timer = null;
		let long = false;
		const cancel = () => clearTimeout(timer);
		icon.addEventListener("pointerdown", () => {
			long = false;
			timer = setTimeout(() => {
				long = true;
				hold();
			}, 500);
		});
		for (const type of ["pointerup", "pointerleave", "pointercancel"])
			icon.addEventListener(type, cancel);
		icon.addEventListener("contextmenu", (event) => event.preventDefault());
		icon.addEventListener("click", () => {
			if (long)
				long = false;
			else
				tap();
		});
	}

	// the way back to the desktop interface, always visible at the end of the bar
	switchIcon() {
		const wrapper = document.createElement("div");
		wrapper.dataset.uniqueid = "switchbutton";
		const icon = document.createElement("div");
		icon.className = "icon noselect icon-switch";
		icon.title = "Switch to the RViz-style interface";
		const text = document.createElement("p");
		text.className = "icon-text";
		text.textContent = "RViz UI";
		icon.appendChild(text);
		icon.addEventListener("click", () => this.app.switchShell("rviz"));
		wrapper.appendChild(icon);
		return wrapper;
	}

	wrapperFor(item) {
		let wrapper = this.wrappers.get(item.id);
		if (!wrapper) {
			wrapper = item.iconElement ?? this.displayIcon(item);
			this.wrappers.set(item.id, wrapper);
		}
		return wrapper;
	}

	renderIcons() {
		const seen = new Set();
		for (const item of this.app.registry.items) {
			seen.add(item.id);
			const wrapper = this.wrapperFor(item);
			// a group's members live in the group
			const group = this.app.registry.groupOf(item);
			const target = group ? this.groupHolder(group.id) : this.icons;
			const add = [...target.children].find((child) => child.dataset.uniqueid === "addbutton") ?? null;
			target.insertBefore(wrapper, add);
			this.paintIcon(item);
			this.paintStatus(item);
		}
		for (const item of this.app.registry.items) {
			if (item.constructor.isGroup)
				this.paintGroup(item);
		}
		// holders of removed groups
		for (const [id, holder] of this.holders ?? []) {
			if (!this.app.registry.get(id)) {
				holder.remove();
				this.holders.delete(id);
			}
		}
		for (const [id, wrapper] of this.wrappers) {
			if (!seen.has(id)) {
				wrapper.remove();
				this.wrappers.delete(id);
			}
		}
		this.calculateWidth();
		window.dispatchEvent(new Event("icons_changed"));
	}

	paintIcon(item) {
		const wrapper = this.wrappers.get(item.id);
		if (!wrapper || item.iconElement)
			return;
		const icon = wrapper.firstElementChild;
		icon.classList.toggle("icon-disabled", !item.enabled);
		if (item.constructor.isGroup)
			return;
		const image = icon.querySelector("object");
		if (!image)
			return; // a widget's own face, painted by the widget
		if (image.getAttribute("data") !== item.icon)
			image.data = item.icon; // recoloured by its load handler
		else if (item.iconColor && image.dataset.color !== item.iconColor)
			setIconColor(image, item.iconColor);
	}

	paintStatus(item) {
		const wrapper = this.wrappers.get(item.id);
		if (!wrapper || item.iconElement)
			return; // template widgets colour their own icon
		const icon = wrapper.firstElementChild;
		icon.classList.toggle("icon-warn", item.status.level === "warn");
		icon.classList.toggle("icon-error", item.status.level === "error");
	}

	setBarHeight(height) {
		this.bar.style.height = height;
		this.icons.style.height = height;
	}

	calculateWidth() {
		if (this.bar.style.height === "")
			this.setBarHeight("75px");
		const rows = Math.max(1, Math.ceil(parseInt(this.bar.style.height) / 60) - 1);
		const width = Math.max(window.innerWidth, Math.ceil(this.icons.children.length / rows) * 60 + 10);
		this.icons.style.width = width + "px";
		this.bar.querySelector("#icon_bar_handle").style.width = width + "px";
		window.dispatchEvent(new Event("iconbar_height_change"));
	}

	// dragging the handle under the bar makes room for more rows of icons
	setupBarDragging(handle) {
		const move = (event) => {
			let y = event.touches && event.touches[0] ? event.touches[0].clientY : event.clientY;
			y = Math.min(360, Math.max(60, Math.floor(y / 60) * 60));
			this.setBarHeight((y + 15) + "px");
			this.calculateWidth();
		};
		const stop = () => {
			document.removeEventListener("mousemove", move);
			document.removeEventListener("touchmove", move);
			document.removeEventListener("mouseup", stop);
			document.removeEventListener("touchend", stop);
			try { window.localStorage.setItem(BAR_HEIGHT_KEY, this.bar.style.height); } catch (e) { /* storage blocked */ }
		};
		const start = (event) => {
			event.preventDefault();
			document.addEventListener("mousemove", move);
			document.addEventListener("touchmove", move);
			document.addEventListener("mouseup", stop);
			document.addEventListener("touchend", stop);
		};
		handle.addEventListener("mousedown", start);
		handle.addEventListener("touchstart", start, { passive: false });
	}

	// ---- modals ----

	// a template widget shows its own modal
	openLegacy(id) {
		const item = this.app.registry.get(id);
		if (item && item.modalElement)
			item.modalElement.style.display = "flex";
	}

	// build(inner) fills the modal and may return a cleanup function
	openModal(title, build) {
		this.closeModal();

		const outer = document.createElement("div");
		outer.className = "modal_outer noselect";
		outer.style.display = "flex";
		outer.style.zIndex = "20";
		const inner = document.createElement("div");
		inner.className = "modal_inner noselect";
		outer.appendChild(inner);

		const heading = document.createElement("h3");
		heading.textContent = title;
		inner.appendChild(heading);

		const dispose = build(inner);
		outer.addEventListener("click", (event) => {
			if (event.target === outer)
				this.closeModal();
		});

		this.modals.appendChild(outer);
		this.modal = { outer, dispose };
	}

	closeModal() {
		if (!this.modal)
			return;
		if (this.modal.dispose)
			this.modal.dispose();
		this.modal.outer.remove();
		this.modal = null;
	}

	openItem(item) {
		this.openModal(item.name, (inner) => {
			// a widget's own panel (readouts, controls) comes first
			const panel = item.constructor.widget || item.constructor.ownPanel ? document.createElement("div") : null;
			if (panel) {
				inner.appendChild(panel);
				item.attachPanel(panel);
				inner.appendChild(hr());
			}
			const picker = buildGroupPicker(item, this.app);
			if (picker)
				inner.appendChild(picker);
			const editor = buildItemEditor(item, this.app);
			inner.appendChild(editor.element);
			inner.appendChild(hr());

			const row = document.createElement("div");
			row.className = "prop_row";
			const label = document.createElement("label");
			label.textContent = "Enabled:";
			const enabled = document.createElement("input");
			enabled.type = "checkbox";
			enabled.checked = item.selfEnabled ?? item.enabled;
			enabled.addEventListener("change", () => this.app.registry.setEnabled(item.id, enabled.checked));
			row.append(label, enabled);
			inner.appendChild(row);

			const remove = document.createElement("button");
			remove.className = "delete_button";
			remove.textContent = "Remove Widget";
			remove.addEventListener("click", () => {
				this.closeModal();
				this.app.registry.remove(item.id);
			});
			inner.appendChild(remove);

			return () => {
				editor.dispose();
				if (panel && item.panelHost === panel)
					item.detachPanel();
			};
		});
	}

	// A group opens as a folder: its members' icons, an add button, its switch and removal.
	openGroup(group) {
		this.openModal(group.name, (inner) => {
			const holder = this.groupHolder(group.id);
			inner.appendChild(holder);
			inner.appendChild(hr());

			const nameRow = document.createElement("div");
			nameRow.className = "prop_row";
			const nameLabel = document.createElement("label");
			nameLabel.textContent = "Name:";
			const name = document.createElement("input");
			name.type = "text";
			name.value = group.name;
			name.addEventListener("change", () => this.app.registry.rename(group.id, name.value));
			nameRow.append(nameLabel, name);

			const row = document.createElement("div");
			row.className = "prop_row";
			const label = document.createElement("label");
			label.textContent = "Show its displays:";
			const enabled = document.createElement("input");
			enabled.type = "checkbox";
			enabled.checked = group.selfEnabled ?? group.enabled;
			enabled.addEventListener("change", () => this.app.registry.setEnabled(group.id, enabled.checked));
			row.append(label, enabled);

			const remove = document.createElement("button");
			remove.className = "delete_button";
			remove.textContent = "Remove group (its displays stay)";
			remove.addEventListener("click", () => {
				this.closeModal();
				this.app.registry.remove(group.id);
			});
			inner.append(nameRow, row, remove);

			// a member's own settings open over the folder; closing those comes back here
			return () => {
				if (this.holders?.get(group.id) === holder)
					this.hidden.appendChild(holder);
			};
		});
	}

	openSettings() {
		this.openModal("Global Settings", (inner) => {
			buildGlobalOptions(inner, this.app);
			inner.appendChild(hr());
			buildCameraControls(inner, this.app);
			inner.appendChild(hr());
			const tools = document.createElement("h4");
			tools.textContent = "Tools";
			inner.appendChild(tools);
			buildToolControls(inner, this.app, () => this.closeModal());
			inner.appendChild(hr());
			const heading = document.createElement("h4");
			heading.textContent = "Manage settings";
			inner.appendChild(heading);
			buildLayoutControls(inner, this.app);
		});
	}
}
