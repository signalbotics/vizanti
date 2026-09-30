import { renderProperties } from './property_editor.js';

// Everything a shell shows for one display: status line, live values, property rows and the
// display's own custom editor. Stays live until dispose() is called.
export function buildItemEditor(item, app) {
	const element = document.createElement("div");
	element.className = "item_editor";

	const status = document.createElement("p");
	status.className = "status";
	const paintStatus = () => {
		status.textContent = "Status: " + item.status.text;
		status.classList.toggle("status-warn", item.status.level === "warn");
		status.classList.toggle("status-error", item.status.level === "error");
	};

	const info = document.createElement("div");
	info.className = "live_data_display";
	const paintInfo = () => {
		const entries = Object.entries(item.info);
		info.style.display = entries.length ? "" : "none";
		info.replaceChildren(...entries.map(([key, value]) => {
			const line = document.createElement("p");
			line.textContent = `${key}: ${value}`;
			return line;
		}));
	};

	const onStatus = (event) => { if (event.detail.item === item) paintStatus(); };
	const onInfo = (event) => { if (event.detail.item === item) paintInfo(); };
	app.registry.addEventListener("status", onStatus);
	app.registry.addEventListener("info", onInfo);
	paintStatus();
	paintInfo();

	const properties = document.createElement("div");
	renderProperties(
		properties,
		item.constructor.properties,
		item.props,
		(key, raw) => app.registry.setProperty(item.id, key, raw),
		app.envFor(item)
	);

	element.append(status, info, properties);

	if (typeof item.buildCustomEditor === "function") {
		const custom = document.createElement("div");
		custom.className = "custom_editor";
		item.buildCustomEditor(custom);
		element.appendChild(custom);
	}

	return {
		element,
		dispose() {
			app.registry.removeEventListener("status", onStatus);
			app.registry.removeEventListener("info", onInfo);
		},
	};
}
