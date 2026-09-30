import { rosbridge } from '../modules/rosbridge.js';
import { tf } from '../modules/tf.js';
import { Registry } from './registry.js';
import { createStorage, resolveBackend, isLayout, STORAGE_KEY } from './storage.js';
import { throttled } from './throttle.js';
import { FrameNodes } from './frames.js';
import { Scene3D, webglSupported } from './scene.js';
import { TouchShell } from '../ui/shell_touch.js';
import { RvizShell } from '../ui/shell_rviz.js';
import { chooseShell, UI_KEY } from '../ui/toggle.js';
import { makeTemplateClass } from '../legacy/template_item.js';
import { installLegacyGlobals } from '../legacy/globals.js';
import { CATALOG } from '../legacy/catalog.js';
import { isLegacyLayout, convertLegacyLayout } from './legacy_layout.js';

// set once the old 2D UI's layout has been reset away, so it is not converted again
const LEGACY_DONE_KEY = "vizanti_legacy_done";

// template folders that are not widgets of their own in the new UI
const TEMPLATE_SKIP = new Set(["add", "settings"]);

const DEFAULT_LAYOUT = {
	version: 2,
	uid: 0,
	global: {},
	ui: {},
	items: [
		{ id: "grid_default", type: "grid", name: "Grid", enabled: true, props: {} },
		{ id: "tf_default", type: "tf", name: "TF", enabled: true, props: {} },
	],
};

function notify(text, { sticky = false } = {}) {
	const box = document.getElementById("notices");
	const notice = document.createElement("div");
	notice.className = "notice";
	notice.textContent = text;
	notice.addEventListener("click", () => notice.remove());
	box.appendChild(notice);
	if (!sticky)
		setTimeout(() => notice.remove(), 8000);
	return notice;
}

// Every .js file under js/displays is a display module; each exported class with a
// static `type` becomes an available display type.
async function loadDisplayTypes() {
	const types = new Map();
	const paths = (await import(`${base_url}/displays/paths`)).default;
	for (const path of paths) {
		try {
			const module = await import(`${base_url}/js/displays/${path}`);
			for (const value of Object.values(module)) {
				if (typeof value === "function" && typeof value.type === "string" && value.type !== "")
					types.set(value.type, value);
			}
		} catch (e) {
			console.error(`Display module ${path} failed to load:`, e);
			notify(`Display module ${path} failed to load. See the browser console.`, { sticky: true });
		}
	}
	return types;
}

// Widgets without a native display still run from their original template. Every template
// category that no display module claims becomes a template-backed type.
async function loadTemplateTypes(types) {
	const files = (await import(`${base_url}/templates/files`)).default;
	const templates = {};
	for (const file of files) {
		const name = file.path.split("/").pop();
		const split = name.lastIndexOf("_");
		if (split === -1)
			continue;
		const category = name.slice(0, split);
		const part = name.slice(split + 1).split(".")[0];
		if (!["icon", "modal", "view", "script"].includes(part))
			continue;
		(templates[category] ??= {})[part] = file.content;
	}
	for (const [category, template] of Object.entries(templates)) {
		if (types.has(category) || TEMPLATE_SKIP.has(category) || !template.icon)
			continue;
		types.set(category, makeTemplateClass(category, template, CATALOG[category]));
	}
}

function legacyHost(id) {
	const element = document.createElement("div");
	element.id = id;
	document.body.appendChild(element);
	return element;
}

function subscribe(topic, msgType, throttleMs, callback) {
	const rosTopic = new ROSLIB.Topic({
		ros: rosbridge.ros,
		name: topic,
		messageType: msgType,
		throttle_rate: throttleMs,
		compression: rosbridge.compression,
		queue_length: 1,
	});
	rosTopic.subscribe(callback);
	return () => rosTopic.unsubscribe(callback);
}

async function start() {
	const root = document.getElementById("app_root");

	if (!webglSupported()) {
		const message = document.createElement("div");
		message.className = "fatal_message";
		message.textContent = "Vizanti needs WebGL to draw the 3D view, and this browser or device does not provide it. "
			+ "Enable hardware acceleration or try another browser.";
		root.appendChild(message);
		return;
	}

	const types = await loadDisplayTypes();
	await loadTemplateTypes(types);

	const legacy = {
		icons: legacyHost("legacy_icons"),
		modals: legacyHost("legacy_modals"),
		views: legacyHost("legacy_views"),
		scripts: legacyHost("legacy_scripts"),
	};

	const frames = new FrameNodes(tf);
	const sceneElement = document.createElement("div");
	sceneElement.className = "scene_container";
	sceneElement.id = "view_container"; // template widgets attach their pointer listeners to this id
	const scene = new Scene3D(sceneElement, frames);

	const context = {
		tf,
		frames,
		scene,
		subscribe,
		legacy,
		requestRender: () => scene.requestRender(),
		// message type of a topic as rosapi reports it, or null when it is not being published
		resolveType: async (topic) => {
			const all = await rosbridge.get_all_topics();
			const index = all.topics.indexOf(topic);
			return index === -1 ? null : all.types[index];
		},
		setProperty: (id, key, value) => registry.setProperty(id, key, value),
	};
	const registry = new Registry({ types, context });
	const storage = createStorage(resolveBackend(() => window.localStorage), STORAGE_KEY);

	// a save still pending when the page reloads would overwrite an import or a reset
	let stopSaving = () => {};

	const app = {
		registry,
		scene,
		sceneElement,
		types,
		tf,
		notify,
		legacy,
		shellName: "touch",
		requestSave: () => {},

		envFor(item) {
			return {
				msgTypes: item ? item.constructor.msgTypes : [],
				listTopics: async (msgTypes) => {
					const lists = await Promise.all(msgTypes.map((type) => rosbridge.get_topics(type)));
					return lists.flat().sort();
				},
				listFrames: () => [...tf.frame_list],
			};
		},

		listAllTopics() {
			return rosbridge.get_all_topics();
		},

		exportLayout() {
			return registry.toJSON();
		},

		// Returns false when the text is not a layout this version can read.
		importLayout(text) {
			let data;
			try {
				data = JSON.parse(text);
			} catch (e) {
				return false;
			}
			if (isLegacyLayout(data))
				data = convertLegacyLayout(data, types); // a file exported by the old 2D UI
			if (!isLayout(data))
				return false;
			if (!storage.save(data))
				return false;
			stopSaving();
			window.location.reload();
			return true;
		},

		resetLayout() {
			stopSaving();
			storage.clear();
			// otherwise the old 2D UI's layout would be converted again on the next load
			try { window.localStorage.setItem(LEGACY_DONE_KEY, "1"); } catch (e) { /* storage blocked */ }
			window.location.reload();
		},
	};
	window.vizanti = app;

	installLegacyGlobals(app);

	// While a tool has taken over the pointer, presses and releases that point above the horizon
	// (orbit view) are dropped, so a tool can never act on a position that is not on the ground.
	for (const type of ["mousedown", "mouseup", "click", "touchstart", "touchend"]) {
		sceneElement.addEventListener(type, (event) => {
			if (scene.inputEnabled)
				return;
			const touch = event.touches?.[0] ?? event.changedTouches?.[0] ?? event;
			if (scene.groundPoint(touch.clientX, touch.clientY))
				return;
			event.stopPropagation();
			if (type === "mousedown" || type === "touchstart")
				notify("That point is above the horizon. Click on the ground.");
		}, true);
	}

	// ---- load the saved layout ----

	const stored = storage.load();

	// First run of this UI: carry over the layout of the old 2D UI if this browser has one,
	// otherwise start from the server's default config (either format).
	let initial = stored.data;
	if (!initial) {
		initial = DEFAULT_LAYOUT;
		const parse = (text) => {
			const data = JSON.parse(text);
			if (isLegacyLayout(data))
				return convertLegacyLayout(data, types);
			return isLayout(data) ? data : null;
		};
		let converted = null;
		try {
			const backend = resolveBackend(() => window.localStorage);
			const old = backend.getItem(LEGACY_DONE_KEY) ? null : backend.getItem("settings");
			converted = old ? parse(old) : null;
		} catch (e) {
			console.warn("The layout of the previous version could not be read:", e);
		}
		if (converted) {
			initial = converted;
			notify("Your widget layout from the previous version of Vizanti was carried over.");
		} else {
			try {
				const text = (await import(`${base_url}/default_widget_config`)).default;
				initial = parse(text) ?? DEFAULT_LAYOUT;
			} catch (e) {
				console.warn("The default config could not be read, using the built-in default:", e);
			}
		}
	}
	if (stored.corrupt)
		notify("The saved layout could not be read, so the default layout was loaded. "
			+ `The old data is kept in browser storage under "${STORAGE_KEY}_backup".`, { sticky: true });
	try {
		registry.load(initial);
	} catch (e) {
		console.error("The saved layout could not be loaded:", e);
		notify("The saved layout could not be loaded, so the default layout was loaded instead.", { sticky: true });
		registry.load(DEFAULT_LAYOUT);
	}

	tf.setFixedFrame(registry.global.fixed_frame);
	scene.setBackground(registry.global.background);
	scene.setCameraState(registry.ui.camera);

	// ---- wiring ----

	let saveFailed = false;
	const save = throttled(() => {
		if (storage.save(registry.toJSON())) {
			saveFailed = false;
		} else if (!saveFailed) {
			saveFailed = true;
			notify("The layout could not be saved: browser storage is full or disabled. "
				+ "Changes will be lost when the page is closed.", { sticky: true });
		}
	}, 400);
	registry.addEventListener("changed", save);
	app.requestSave = save;

	registry.addEventListener("global", (event) => {
		if (event.detail.key === "fixed_frame")
			tf.setFixedFrame(event.detail.value);
		if (event.detail.key === "background")
			scene.setBackground(event.detail.value);
	});

	const each = (hook) => {
		for (const item of registry.items) {
			if (item.enabled)
				item._safe(hook);
		}
	};

	window.addEventListener("tf_changed", () => {
		frames.update();
		scene.followTarget();
		each("onTfChange");
		scene.requestRender();
	});

	window.addEventListener("tf_fixed_frame_changed", () => {
		frames.update();
		each("onFixedFrameChange");
		scene.requestRender();
	});

	const saveCamera = throttled(() => registry.setUi("camera", scene.getCameraState()), 400);
	// The template widgets' overlays live in a window-level layer that is kept over the 3D view.
	app.syncLegacyViews = () => {
		const rect = sceneElement.getBoundingClientRect();
		const style = legacy.views.style;
		style.left = rect.left + "px";
		style.top = rect.top + "px";
		style.width = rect.width + "px";
		style.height = rect.height + "px";
		style.setProperty("--vx", rect.left + "px");
		style.setProperty("--vy", rect.top + "px");
	};
	window.addEventListener("resize", app.syncLegacyViews);

	scene.onCameraChange(() => {
		each("onCameraChange");
		saveCamera();
		app.syncLegacyViews();
		window.dispatchEvent(new Event("view_changed"));
	});
	scene.onContextRestored(() => each("onContextRestored"));
	stopSaving = () => {
		save.cancel();
		saveCamera.cancel();
	};

	let connectionNotice = null;
	const showConnection = () => {
		if (connectionNotice) {
			connectionNotice.remove();
			connectionNotice = null;
		}
		if (!rosbridge.connected)
			connectionNotice = notify("Rosbridge: " + rosbridge.status, { sticky: true });
	};
	window.addEventListener("rosbridge_change", showConnection);
	showConnection();

	const readStoredShell = () => {
		try {
			return window.localStorage.getItem(UI_KEY);
		} catch (e) {
			return null;
		}
	};

	const mountShell = (name) => {
		app.shellName = name;
		app.shell = name === "rviz" ? new RvizShell(app) : new TouchShell(app);
		app.shell.mount(root);
		scene.resize();
		app.syncLegacyViews();
	};

	// Swaps only the chrome: the scene, displays, subscriptions and camera are untouched.
	app.switchShell = (name) => {
		if (name === app.shellName)
			return;
		app.shell.unmount();
		try {
			window.localStorage.setItem(UI_KEY, name);
		} catch (e) { /* storage unavailable: the choice lasts until reload */ }

		// a ?ui= parameter would override the new choice on the next reload
		const url = new URL(window.location.href);
		if (url.searchParams.has("ui")) {
			url.searchParams.delete("ui");
			window.history.replaceState(null, "", url);
		}
		mountShell(name);
	};

	const initialShell = chooseShell({
		query: window.location.search,
		stored: readStoredShell(),
		width: window.innerWidth,
		coarsePointer: window.matchMedia("(pointer: coarse)").matches,
	});

	// The RViz UI opens in the 3D orbit view; the touch UI keeps the top-down view it always had.
	// Only applies until the user has a saved camera of their own. Set before the shell is
	// built so its camera control shows the right mode.
	if (!registry.ui.camera && initialShell === "rviz")
		scene.setCameraMode("orbit");
	mountShell(initialShell);

	each("onCameraChange");
	scene.requestRender();
}

start().catch((e) => {
	console.error("Vizanti failed to start:", e);
	const message = document.createElement("div");
	message.className = "fatal_message";
	message.textContent = "Vizanti failed to start: " + e.message + " See the browser console for details.";
	document.getElementById("app_root").replaceChildren(message);
});
