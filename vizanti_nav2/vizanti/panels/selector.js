// The Selector panel (nav2_rviz_plugins/Selector) for Vizanti: picks the controller, planner,
// goal checker, smoother, progress checker and path handler Nav2 uses, as in RViz. The lists come
// from the servers' parameters; a choice is published on <name>_selector (transient local).
import { PanelPlugin, WIDGET_PROPERTIES } from '@vizanti/plugin_api.js';
import { SELECTORS, pluginNames, initialItems, choose } from '../selector_logic.js';

if (!document.querySelector("link[data-vizanti-nav2]")) {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = new URL("../nav2.css", import.meta.url).href;
	link.dataset.vizantiNav2 = "";
	document.head.appendChild(link);
}

const RETRY_MS = 5000; // the RViz panel tries again at 0.2 Hz until every list is loaded

export class SelectorPanel extends PanelPlugin {

	static properties = { ...WIDGET_PROPERTIES };

	onCreate() {
		this.items = Object.fromEntries(SELECTORS.map((s) => [s.key, []]));
		this.status.ok("Loading the Nav2 plugin lists…");
		this.load();
	}

	onDestroy() {
		clearTimeout(this.retry);
		this.destroyed = true;
	}

	async load() {
		for (const selector of SELECTORS) {
			if (this.items[selector.key].length > 0)
				continue;
			try {
				const response = await this.ctx.callService(`/${selector.server}/get_parameters`, "rcl_interfaces/srv/GetParameters", { names: [selector.parameter] }, 3000);
				const names = pluginNames(response);
				if (names)
					this.items[selector.key] = initialItems(names);
			} catch (e) {
				// that server is not up yet: the next round asks again
			}
			if (this.destroyed)
				return;
		}
		this.render();
		const missing = SELECTORS.filter((s) => this.items[s.key].length === 0);
		if (missing.length === 0) {
			this.status.ok("Plugin lists loaded.");
			return;
		}
		this.status.warn(`Waiting for ${[...new Set(missing.map((s) => s.server))].join(", ")}…`);
		this.retry = setTimeout(() => this.load(), RETRY_MS);
	}

	buildPanel(container) {
		container.classList.add("nav2_panel", "nav2_selector");
		this.selects = {};
		// two per row, label above its drop-down, as in RViz
		for (let i = 0; i < SELECTORS.length; i += 2) {
			const row = document.createElement("div");
			row.className = "nav2_selector_row";
			for (const selector of SELECTORS.slice(i, i + 2)) {
				const cell = document.createElement("label");
				cell.className = "nav2_selector_cell";
				const title = document.createElement("span");
				title.textContent = selector.label;
				const select = document.createElement("select");
				select.addEventListener("change", () => this.select(selector, select.value));
				this.selects[selector.key] = select;
				cell.append(title, select);
				row.appendChild(cell);
			}
			container.appendChild(row);
		}
		this.render();
	}

	select(selector, chosen) {
		const { items, selected, publish } = choose(this.items[selector.key], chosen);
		this.items[selector.key] = items;
		if (publish !== null)
			this.ctx.publish(`/${selector.topic}`, "std_msgs/msg/String", { data: publish }, { latched: true });
		this.render(selected === null ? {} : { [selector.key]: selected });
	}

	render(selected = {}) {
		if (!this.selects)
			return;
		for (const selector of SELECTORS) {
			const select = this.selects[selector.key];
			const items = this.items[selector.key];
			const current = selected[selector.key] ?? select.value;
			if (select.options.length !== items.length || [...select.options].some((o, i) => o.value !== items[i]))
				select.replaceChildren(...items.map((name) => new Option(name, name)));
			select.disabled = items.length === 0;
			if (items.includes(current))
				select.value = current;
		}
	}
}
