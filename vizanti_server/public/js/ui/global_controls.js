import { renderProperties } from './property_editor.js';
import { TOOLS } from '../core/tools.js';
import { saveView, removeView, sanitizeViews } from '../core/views.js';

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
			options: [
				{ value: "topdown", label: "Top-down (orthographic)" },
				{ value: "orbit", label: "Orbit" },
				{ value: "fps", label: "FPS (first person)" },
			],
			help: "Orbit: left-drag rotates, right-drag pans, wheel zooms. FPS: left-drag looks around, "
				+ "right-drag slides, wheel or arrow keys move (Shift for faster), PageUp/PageDown move up and down.",
		},
		target_frame: { type: "frame", label: "Target Frame" },
		follow_yaw: { type: "bool", label: "Turn with target frame", help: "With a target frame set, the orbit camera swings round as the frame turns (a third-person view)." },
	}, scene.getCameraState(), (key, raw) => {
		if (key === "mode")
			scene.setCameraMode(raw);
		else if (key === "follow_yaw")
			scene.setFollowYaw(raw);
		else
			scene.setTargetFrame(raw);
		return { ok: true, value: raw };
	}, app.envFor(null));

	// keep the selector in step when the camera mode is changed elsewhere
	const modeSelect = container.querySelector("select");
	scene.onCameraChange(() => {
		if (modeSelect && modeSelect.isConnected && modeSelect.value !== scene.mode)
			modeSelect.value = scene.mode;
	});

	container.appendChild(button("Reset Camera View", () => scene.resetCamera()));
	container.appendChild(comment("Reset only the camera to its default pose (zero relative to the fixed frame link)."));

	// ---- saved views ----
	const heading = document.createElement("h4");
	heading.textContent = "Saved views";
	const list = document.createElement("div");
	const views = () => sanitizeViews(app.registry.ui.saved_views);
	const render = () => {
		list.replaceChildren();
		for (const view of views()) {
			const row = document.createElement("div");
			row.className = "saved_view";
			const name = document.createElement("span");
			name.textContent = view.name + ` (${{ orbit: "orbit", fps: "FPS", topdown: "top-down" }[view.camera.mode]})`;
			row.append(
				name,
				button("Go", () => scene.setCameraState(view.camera)),
				button("✕", () => {
					app.registry.setUi("saved_views", removeView(views(), view.name));
					render();
				})
			);
			list.appendChild(row);
		}
	};
	const nameInput = document.createElement("input");
	nameInput.type = "text";
	nameInput.placeholder = "View name";
	nameInput.className = "saved_view_name";
	const save = () => {
		try {
			const name = nameInput.value.trim() || "view " + (views().length + 1);
			app.registry.setUi("saved_views", saveView(views(), name, scene.getCameraState()));
			nameInput.value = "";
			render();
		} catch (e) {
			app.notify(e.message);
		}
	};
	nameInput.addEventListener("keydown", (event) => {
		if (event.key === "Enter")
			save();
	});
	container.append(heading, list, nameInput, button("Save current view", save));
	render();

	// a loaded config or layout brings its own views; stop listening once the panel is gone
	const onChange = (event) => {
		if (!list.isConnected) {
			app.registry.removeEventListener("ui", onChange);
			app.registry.removeEventListener("loaded", onChange);
			return;
		}
		if (event.type === "loaded" || event.detail.key === "saved_views")
			render();
	};
	app.registry.addEventListener("ui", onChange);
	app.registry.addEventListener("loaded", onChange);
}

// Buttons for the built-in pointer tools and the topics they publish to.
// onSelect runs after a tool was chosen (the touch UI closes its modal there).
export function buildToolControls(container, app, onSelect = () => {}) {
	const row = document.createElement("div");
	row.className = "tool_buttons";
	const paint = () => {
		for (const element of row.children)
			element.classList.toggle("tool_active", element.dataset.tool === app.tools.active);
	};
	for (const tool of TOOLS) {
		const element = button(tool.label, () => {
			app.tools.select(tool.id);
			paint();
			onSelect(tool.id);
		});
		element.dataset.tool = tool.id;
		element.title = `${tool.hint} Shortcut: ${tool.key}`;
		row.appendChild(element);
	}
	paint();
	container.appendChild(row);

	renderProperties(container, {
		point_topic: { type: "string", label: "Publish Point topic" },
		goal_topic: { type: "string", label: "Goal Pose topic" },
		estimate_topic: { type: "string", label: "Pose Estimate topic" },
	}, app.tools.options, (key, raw) => {
		app.tools.setOption(key, raw);
		return { ok: true, value: app.tools.options[key] };
	}, app.envFor(null));
	return paint;
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
		picker.accept = ".json,.rviz";
		picker.onchange = () => {
			const reader = new FileReader();
			reader.onload = () => {
				if (!app.importLayout(reader.result))
					app.notify("That file is not a Vizanti layout or RViz config this version can read, so nothing was changed.");
			};
			reader.readAsText(picker.files[0]);
		};
		picker.click();
	}, "export_button"));

	container.appendChild(row);
	container.appendChild(comment("Exporting the current configuration will save the widget layout, settings, camera pose, and other info, so it can be imported later. Import also takes RViz .rviz configs."));

	// ---- layouts kept on the robot ----
	const robot = document.createElement("div");
	robot.className = "prop_row";
	const robotLabel = document.createElement("label");
	robotLabel.textContent = "On the robot:";
	const select = document.createElement("select");
	robot.append(robotLabel, select);
	container.appendChild(robot);

	const refresh = async (selected) => {
		try {
			const names = await app.configs.list();
			select.replaceChildren();
			for (const name of names) {
				const option = document.createElement("option");
				option.value = name;
				option.textContent = name;
				select.appendChild(option);
			}
			if (names.length === 0) {
				const option = document.createElement("option");
				option.value = "";
				option.textContent = "(none saved yet)";
				select.appendChild(option);
			}
			if (selected && names.includes(selected))
				select.value = selected;
		} catch (e) {
			app.notify(e.message);
		}
	};
	refresh();

	const robotButtons = document.createElement("span");
	robotButtons.appendChild(button("Load", async () => {
		if (!select.value)
			return;
		try {
			const layout = await app.configs.load(select.value);
			if (!app.importLayout(JSON.stringify(layout)))
				app.notify(`"${select.value}" is not a layout this version of Vizanti can read.`);
		} catch (e) {
			app.notify(e.message);
		}
	}, "export_button"));
	robotButtons.appendChild(button("Save as…", async () => {
		const name = prompt("Save the current layout on the robot as:", select.value || "robot_config");
		if (name === null)
			return;
		try {
			await app.configs.save(name.trim(), app.exportLayout());
			app.notify(`Saved "${name.trim()}" on the robot.`);
			refresh(name.trim());
		} catch (e) {
			app.notify(e.message);
		}
	}, "export_button"));
	robotButtons.appendChild(button("Delete", async () => {
		if (!select.value || !confirm(`Delete the config "${select.value}" from the robot?`))
			return;
		try {
			await app.configs.remove(select.value);
			refresh();
		} catch (e) {
			app.notify(e.message);
		}
	}, "export_button"));
	container.appendChild(robotButtons);
	container.appendChild(comment("Configs saved on the robot are available to every browser that opens Vizanti."));

	container.appendChild(button("Save screenshot", () => app.saveScreenshot()));
	container.appendChild(comment("Downloads the 3D view as a PNG image."));

	container.appendChild(button("Reset Layout to default", () => {
		if (confirm("Are you sure you want to delete your saved widget setup? This will refresh the page."))
			app.resetLayout();
	}));
	container.appendChild(comment("Clear layout and import server defaults."));

	const other = app.shellName === "rviz" ? "touch" : "rviz";
	container.appendChild(button(other === "rviz" ? "Switch to RViz UI" : "Switch to Touch UI", () => app.switchShell(other)));
	container.appendChild(comment("Both interfaces show the same displays. The choice is remembered on this browser."));
}
