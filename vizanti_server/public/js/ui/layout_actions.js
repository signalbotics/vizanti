// Layout file actions shared by the touch UI's settings and the RViz UI's menu.

export function exportLayoutFile(app) {
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
}

export function importLayoutFile(app) {
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
}

export function resetLayoutAsk(app) {
	if (confirm("Are you sure you want to delete your saved widget setup? This will refresh the page."))
		app.resetLayout();
}

export async function loadRobotConfig(app, name) {
	try {
		const layout = await app.configs.load(name);
		if (!app.importLayout(JSON.stringify(layout)))
			app.notify(`"${name}" is not a layout this version of Vizanti can read.`);
	} catch (e) {
		app.notify(e.message);
	}
}

// Returns the saved name, or null when cancelled or failed.
export async function saveRobotConfigAs(app, suggested = "robot_config") {
	const name = prompt("Save the current layout on the robot as:", suggested);
	if (name === null)
		return null;
	try {
		await app.configs.save(name.trim(), app.exportLayout());
		app.notify(`Saved "${name.trim()}" on the robot.`);
		return name.trim();
	} catch (e) {
		app.notify(e.message);
		return null;
	}
}

// Returns true when deleted.
export async function deleteRobotConfigAsk(app, name) {
	if (!name || !confirm(`Delete the config "${name}" from the robot?`))
		return false;
	try {
		await app.configs.remove(name);
		return true;
	} catch (e) {
		app.notify(e.message);
		return false;
	}
}
