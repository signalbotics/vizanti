import { buildItemEditor } from './item_editor.js';
import { buildGlobalOptions, buildCameraControls, buildLayoutControls } from './global_controls.js';
import { openAddDialog } from './add_dialog.js';

function hr() {
	const element = document.createElement("hr");
	element.className = "dark_hr";
	return element;
}

// The icon bar UI for phones and tablets: one icon per display, a modal per icon.
export class TouchShell {

	constructor(app) {
		this.app = app;
		this.handlers = [];
		this.modal = null;
	}

	listen(name, fn) {
		this.app.registry.addEventListener(name, fn);
		this.handlers.push([name, fn]);
	}

	mount(root) {
		this.root = root;

		const bar = document.createElement("div");
		bar.id = "icon_bar";
		this.icons = document.createElement("div");
		this.icons.id = "icon_container";
		bar.appendChild(this.icons);
		bar.addEventListener("wheel", (event) => { bar.scrollLeft += event.deltaY * 0.5; });

		const view = document.createElement("div");
		view.id = "view_container";
		view.appendChild(this.app.sceneElement);

		this.modals = document.createElement("div");
		this.modals.id = "modal_container";

		root.append(bar, view, this.modals);

		for (const name of ["added", "removed", "reordered", "loaded", "enabled", "property"])
			this.listen(name, () => this.renderIcons());
		this.listen("status", (event) => this.paintStatus(event.detail.item));

		this.renderIcons();
	}

	unmount() {
		for (const [name, fn] of this.handlers)
			this.app.registry.removeEventListener(name, fn);
		this.handlers = [];
		this.closeModal();
		this.app.sceneElement.remove();
		this.root.replaceChildren();
	}

	iconButton(src, title, onClick) {
		const element = document.createElement("div");
		element.className = "icon noselect";
		element.title = title;
		const image = document.createElement("img");
		image.src = src;
		image.alt = title;
		element.appendChild(image);
		element.addEventListener("click", onClick);
		return element;
	}

	renderIcons() {
		this.icons.replaceChildren();
		this.icons.appendChild(this.iconButton("assets/settings.svg", "Global Settings", () => this.openSettings()));

		for (const item of this.app.registry.items) {
			const element = this.iconButton(item.icon, item.name, () => this.openItem(item));
			element.dataset.id = item.id;
			element.classList.toggle("icon-disabled", !item.enabled);
			this.icons.appendChild(element);
			this.paintStatus(item);
		}

		this.icons.appendChild(this.iconButton("assets/add.svg", "Add", () => openAddDialog(this.app)));
	}

	paintStatus(item) {
		const element = [...this.icons.children].find((child) => child.dataset.id === item.id);
		if (!element)
			return;
		element.classList.toggle("icon-warn", item.status.level === "warn");
		element.classList.toggle("icon-error", item.status.level === "error");
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
			const editor = buildItemEditor(item, this.app);
			inner.appendChild(editor.element);
			inner.appendChild(hr());

			const row = document.createElement("div");
			row.className = "prop_row";
			const label = document.createElement("label");
			label.textContent = "Enabled:";
			const enabled = document.createElement("input");
			enabled.type = "checkbox";
			enabled.checked = item.enabled;
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

			return () => editor.dispose();
		});
	}

	openSettings() {
		this.openModal("Global Settings", (inner) => {
			buildGlobalOptions(inner, this.app);
			inner.appendChild(hr());
			buildCameraControls(inner, this.app);
			inner.appendChild(hr());
			const heading = document.createElement("h4");
			heading.textContent = "Manage settings";
			inner.appendChild(heading);
			buildLayoutControls(inner, this.app);
		});
	}
}
