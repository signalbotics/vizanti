import { exportLayoutFile, importLayoutFile, resetLayoutAsk, loadRobotConfig, saveRobotConfigAs, deleteRobotConfigAsk } from './layout_actions.js';

// The RViz UI's main menu: layout files, configs saved on the robot, screenshot, reset and the
// switch to the touch UI. Opens under `anchor`; closes on Escape, a click outside or a choice.
export class AppMenu {

	constructor(app, anchor) {
		this.app = app;
		this.anchor = anchor;
		this.element = null;
		this.onOutside = (event) => {
			if (this.element && !this.element.contains(event.target) && !anchor.contains(event.target))
				this.close();
		};
		this.onKey = (event) => this.key(event);
	}

	get isOpen() { return this.element !== null; }

	toggle() {
		if (this.isOpen)
			this.close();
		else
			this.open();
	}

	open() {
		const menu = document.createElement("div");
		menu.className = "app_menu";
		menu.setAttribute("role", "menu");
		menu.setAttribute("aria-label", "Main menu");

		const item = (label, action, { hint = "", danger = false } = {}) => {
			const element = document.createElement("button");
			element.className = "app_menu_item" + (danger ? " app_menu_danger" : "");
			element.setAttribute("role", "menuitem");
			element.textContent = label;
			if (hint)
				element.title = hint;
			element.addEventListener("click", () => {
				this.close();
				action();
			});
			return element;
		};
		const heading = (text) => {
			const element = document.createElement("div");
			element.className = "app_menu_heading";
			element.textContent = text;
			return element;
		};
		const separator = () => {
			const element = document.createElement("div");
			element.className = "app_menu_separator";
			element.setAttribute("role", "separator");
			return element;
		};

		const robotList = document.createElement("div");
		robotList.className = "app_menu_robot_list";
		robotList.textContent = "Loading…";

		menu.append(
			heading("Layout"),
			item("Import layout or .rviz…", () => importLayoutFile(this.app), { hint: "Load a Vizanti layout (.json) or an RViz config (.rviz) from a file" }),
			item("Export layout…", () => exportLayoutFile(this.app), { hint: "Download the current layout as a .json file" }),
			separator(),
			heading("On the robot"),
			robotList,
			item("Save layout on the robot…", async () => {
				await saveRobotConfigAs(this.app);
			}, { hint: "Store the current layout on the Vizanti server, for every browser" }),
			separator(),
			item("Save screenshot", () => this.app.saveScreenshot(), { hint: "Download the 3D view as a PNG image" }),
			separator(),
			item("Switch to Touch UI", () => this.app.switchShell("touch"), { hint: "The interface for phones and tablets; the choice is remembered on this browser" }),
			item("Reset layout to default…", () => resetLayoutAsk(this.app), { hint: "Clear the saved layout and load the server's default", danger: true })
		);

		const rect = this.anchor.getBoundingClientRect();
		menu.style.left = `${Math.round(rect.left)}px`;
		menu.style.top = `${Math.round(rect.bottom + 4)}px`;
		document.body.appendChild(menu);
		this.element = menu;
		this.anchor.setAttribute("aria-expanded", "true");
		document.addEventListener("pointerdown", this.onOutside, true);
		document.addEventListener("keydown", this.onKey, true);
		this.focusItem(0);
		this.fillRobotList(robotList);
	}

	async fillRobotList(list) {
		let names;
		try {
			names = await this.app.configs.list();
		} catch (e) {
			list.textContent = "The robot's configs could not be read.";
			return;
		}
		if (!list.isConnected)
			return;
		list.replaceChildren();
		if (names.length === 0) {
			list.textContent = "None saved yet.";
			return;
		}
		for (const name of names) {
			const row = document.createElement("div");
			row.className = "app_menu_robot_row";
			const load = document.createElement("button");
			load.className = "app_menu_item";
			load.setAttribute("role", "menuitem");
			load.textContent = name;
			load.title = `Load "${name}"`;
			load.addEventListener("click", () => {
				this.close();
				loadRobotConfig(this.app, name);
			});
			const remove = document.createElement("button");
			remove.className = "app_menu_remove";
			remove.textContent = "✕";
			remove.title = `Delete "${name}" from the robot`;
			remove.setAttribute("aria-label", `Delete ${name}`);
			remove.addEventListener("click", async () => {
				if (await deleteRobotConfigAsk(this.app, name))
					row.remove();
			});
			row.append(load, remove);
			list.appendChild(row);
		}
	}

	items() {
		return this.element ? [...this.element.querySelectorAll(".app_menu_item")] : [];
	}

	focusItem(index) {
		const items = this.items();
		if (items.length)
			items[(index + items.length) % items.length].focus();
	}

	key(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			this.close();
			this.anchor.focus();
			return;
		}
		if (event.key !== "ArrowDown" && event.key !== "ArrowUp")
			return;
		event.preventDefault();
		const items = this.items();
		const at = items.indexOf(document.activeElement);
		this.focusItem(at + (event.key === "ArrowDown" ? 1 : -1));
	}

	close() {
		if (!this.element)
			return;
		this.element.remove();
		this.element = null;
		this.anchor.setAttribute("aria-expanded", "false");
		document.removeEventListener("pointerdown", this.onOutside, true);
		document.removeEventListener("keydown", this.onKey, true);
	}
}

// A right-click menu at (x, y). entries: [{ label, action, disabled?, danger? } | "-"]
export function openContextMenu(x, y, entries) {
	document.querySelector(".app_menu.context_menu")?.remove();
	const menu = document.createElement("div");
	menu.className = "app_menu context_menu";
	menu.setAttribute("role", "menu");
	const close = () => {
		menu.remove();
		document.removeEventListener("pointerdown", outside, true);
		document.removeEventListener("keydown", key, true);
	};
	const outside = (event) => {
		if (!menu.contains(event.target))
			close();
	};
	const key = (event) => {
		const items = [...menu.querySelectorAll(".app_menu_item:not(:disabled)")];
		if (event.key === "Escape") {
			event.preventDefault();
			close();
		} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			event.preventDefault();
			const at = items.indexOf(document.activeElement);
			items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
		}
	};
	for (const entry of entries) {
		if (entry === "-") {
			const separator = document.createElement("div");
			separator.className = "app_menu_separator";
			menu.appendChild(separator);
			continue;
		}
		const item = document.createElement("button");
		item.className = "app_menu_item" + (entry.danger ? " app_menu_danger" : "");
		item.setAttribute("role", "menuitem");
		item.textContent = entry.label;
		item.disabled = !!entry.disabled;
		item.addEventListener("click", () => {
			close();
			entry.action();
		});
		menu.appendChild(item);
	}
	document.body.appendChild(menu);
	// keep it on screen
	const width = menu.offsetWidth, height = menu.offsetHeight;
	menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - width - 4))}px`;
	menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - height - 4))}px`;
	document.addEventListener("pointerdown", outside, true);
	document.addEventListener("keydown", key, true);
	menu.querySelector(".app_menu_item:not(:disabled)")?.focus();
	return close;
}
