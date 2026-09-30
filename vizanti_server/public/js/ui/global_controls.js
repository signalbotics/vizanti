import { renderProperties } from './property_editor.js';

function button(text, onClick, className = "") {
	const element = document.createElement("button");
	element.textContent = text;
	if (className)
		element.className = className;
	element.addEventListener("click", onClick);
	return element;
}

function comment(text) {
	const element = document.createElement("p");
	element.className = "comment";
	element.textContent = text;
	return element;
}

export function buildGlobalOptions(container, app) {
	renderProperties(container, {
		fixed_frame: { type: "frame", label: "Fixed Frame", noDefault: true },
		background: { type: "color", label: "Background Color" },
	}, app.registry.global, (key, raw) => app.registry.setGlobal(key, raw), app.envFor(null));
}

export function buildCameraControls(container, app) {
	const scene = app.scene;
	renderProperties(container, {
		mode: {
			type: "enum", label: "Camera",
			options: [{ value: "topdown", label: "Top-down (orthographic)" }, { value: "orbit", label: "Orbit" }],
		},
		target_frame: { type: "frame", label: "Target Frame" },
	}, scene.getCameraState(), (key, raw) => {
		if (key === "mode")
			scene.setCameraMode(raw);
		else
			scene.setTargetFrame(raw);
		return { ok: true, value: raw };
	}, app.envFor(null));

	container.appendChild(button("Reset Camera View", () => scene.resetCamera()));
	container.appendChild(comment("Reset only the camera to its default pose (zero relative to the fixed frame link)."));
}

export function buildLayoutControls(container, app) {
	const row = document.createElement("span");

	row.appendChild(button("⇑ Export", () => {
		const filename = prompt("Save as file (.json will be appended automatically):", "robot_config");
		if (filename === null)
			return;
		const blob = new Blob([JSON.stringify(app.exportLayout(), null, 2)], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = filename + ".json";
		link.click();
		URL.revokeObjectURL(url);
	}, "export_button"));

	row.appendChild(button("⇓ Import", () => {
		const picker = document.createElement("input");
		picker.type = "file";
		picker.accept = ".json";
		picker.onchange = () => {
			const reader = new FileReader();
			reader.onload = () => {
				if (!app.importLayout(reader.result))
					app.notify("That file is not a layout this version of Vizanti can read, so nothing was changed.");
			};
			reader.readAsText(picker.files[0]);
		};
		picker.click();
	}, "export_button"));

	container.appendChild(row);
	container.appendChild(comment("Exporting the current configuration will save the widget layout, settings, camera pose, and other info, so it can be imported later."));

	container.appendChild(button("Reset Layout to default", () => {
		if (confirm("Are you sure you want to delete your saved widget setup? This will refresh the page."))
			app.resetLayout();
	}));
	container.appendChild(comment("Clear layout and import server defaults."));
}
