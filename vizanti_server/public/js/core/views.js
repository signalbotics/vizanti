import { sanitizeCameraState } from './camera_state.js';

// Named camera views kept in the layout, like RViz's saved views.

export function saveView(views, name, camera) {
	const trimmed = typeof name === "string" ? name.trim() : "";
	if (!trimmed)
		throw new Error("A view needs a name.");
	const entry = { name: trimmed, camera: sanitizeCameraState(camera) };
	const index = views.findIndex((view) => view.name === trimmed);
	if (index === -1)
		return [...views, entry];
	const out = [...views];
	out[index] = entry;
	return out;
}

export function removeView(views, name) {
	return views.filter((view) => view.name !== name);
}

export function sanitizeViews(data) {
	if (!Array.isArray(data))
		return [];
	return data
		.filter((view) => view !== null && typeof view === "object" && typeof view.name === "string" && view.name.trim() !== "")
		.map((view) => ({ name: view.name.trim(), camera: sanitizeCameraState(view.camera) }));
}
