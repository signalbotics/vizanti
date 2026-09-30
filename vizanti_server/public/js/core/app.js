import { rosbridge } from '../modules/rosbridge.js';
import { tf } from '../modules/tf.js';
import { Registry } from './registry.js';
import { createStorage, isLayout, STORAGE_KEY } from './storage.js';
import { FrameNodes } from './frames.js';
import { Scene3D, webglSupported } from './scene.js';

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

// runs fn at most once per `ms`, after the burst
function throttled(fn, ms) {
	let timer = null;
	return () => {
		if (timer !== null)
			return;
		timer = setTimeout(() => {
			timer = null;
			fn();
		}, ms);
	};
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

	const frames = new FrameNodes(tf);
	const sceneElement = document.createElement("div");
	sceneElement.className = "scene_container";
	const scene = new Scene3D(sceneElement, frames);

	const context = {
		tf,
		frames,
		scene,
		subscribe,
		requestRender: () => scene.requestRender(),
		setProperty: (id, key, value) => registry.setProperty(id, key, value),
	};
	const registry = new Registry({ types, context });
	const storage = createStorage(window.localStorage, STORAGE_KEY);

	const app = {
		registry,
		scene,
		sceneElement,
		types,
		tf,
		notify,
		shellName: "touch",

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
			if (!isLayout(data))
				return false;
			if (!storage.save(data))
				return false;
			window.location.reload();
			return true;
		},

		resetLayout() {
			storage.clear();
			window.location.reload();
		},
	};
	window.vizanti = app;

	// ---- load the saved layout ----

	const stored = storage.load();
	if (stored.corrupt)
		notify("The saved layout could not be read, so the default layout was loaded. "
			+ `The old data is kept in browser storage under "${STORAGE_KEY}_backup".`, { sticky: true });
	registry.load(stored.data ?? DEFAULT_LAYOUT);

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
	scene.onCameraChange(() => {
		each("onCameraChange");
		saveCamera();
	});
	scene.onContextRestored(() => each("onContextRestored"));

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

	// TEMPORARY: replaced by a shell in Task 9
	root.appendChild(sceneElement);

	each("onCameraChange");
	scene.requestRender();
}

start();
