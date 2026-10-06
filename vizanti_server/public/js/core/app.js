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
import { ToolManager, TOOLS } from './tools.js';
import { createConfigClient, startupConfig } from './configs.js';
import { formatDistance } from '../geometry/shapes.js';
import { parseYaml, isRvizConfig, convertRvizConfig } from './rviz_import.js';
import { createQosInjector, withQosProperty } from './qos.js';

// set once the old 2D UI's layout has been reset away, so it is not converted again
const LEGACY_DONE_KEY = "vizanti_legacy_done";

// a message to show once after the reload that applies an imported layout
const NOTICE_KEY = "vizanti_notice";

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

	// display plugins installed by other ROS packages; built-in types win a name clash
	try {
		const plugins = (await import(`${base_url}/plugins/paths`)).default;
		for (const path of plugins) {
			try {
				const module = await import(`${base_url}/plugins/${path}`);
				for (const value of Object.values(module)) {
					if (typeof value !== "function" || typeof value.type !== "string" || value.type === "")
						continue;
					if (types.has(value.type)) {
						notify(`Plugin ${path} defines the display type "${value.type}", which already exists; it was not loaded.`, { sticky: true });
						continue;
					}
					types.set(value.type, value);
				}
			} catch (e) {
				console.error(`Display plugin ${path} failed to load:`, e);
				notify(`Display plugin ${path} failed to load. See the browser console.`, { sticky: true });
			}
		}
	} catch (e) {
		console.warn("The list of display plugins could not be read:", e);
	}
	// every display that subscribes to a topic gets a QoS choice
	for (const Cls of types.values())
		withQosProperty(Cls);
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

// Large array-heavy messages travel as CBOR: the arrays arrive as typed arrays instead of JSON
// text or base64, which is smaller on the wire and much cheaper to decode. The native displays
// read both forms; template widgets keep the server's default.
const BINARY_TYPES = new Set([
	"sensor_msgs/msg/PointCloud2",
	"sensor_msgs/msg/Image",
	"sensor_msgs/msg/LaserScan",
	"nav_msgs/msg/OccupancyGrid",
	"map_msgs/msg/OccupancyGridUpdate",
]);

// Adds a display's chosen QoS to each subscribe request rosbridge receives for its topic.
const qosInjector = createQosInjector();
{
	const send = rosbridge.ros.callOnConnection.bind(rosbridge.ros);
	rosbridge.ros.callOnConnection = (message) => send(qosInjector.apply(message));
}

// qos: a rosbridge QoS object, or null to let rosbridge match the publishers
function subscribe(topic, msgType, throttleMs, callback, qos = null) {
	const releaseQos = qosInjector.use(topic, qos);
	const rosTopic = new ROSLIB.Topic({
		ros: rosbridge.ros,
		name: topic,
		messageType: msgType,
		throttle_rate: throttleMs,
		compression: BINARY_TYPES.has(msgType) ? "cbor" : rosbridge.compression,
		queue_length: 1,
	});
	rosTopic.subscribe(callback);
	return () => {
		rosTopic.unsubscribe(callback);
		releaseQos();
	};
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
		publish: (topic, type, msg, options = {}) => publish(topic, type, msg, false, options),
		// a display that edits by pointer (the Waypoints editor) while its edit mode is on
		setPointerEditor: (display) => setPointerEditor(display),
		// resolves with the response, rejects on failure or after 5 s
		callService: (name, type, request) => new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("no answer within 5 s")), 5000);
			new ROSLIB.Service({ ros: rosbridge.ros, name, serviceType: type }).callService(
				new ROSLIB.ServiceRequest(request),
				(response) => { clearTimeout(timer); resolve(response); },
				(error) => { clearTimeout(timer); reject(new Error(String(error))); }
			);
		}),
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

	// set up with the tools below; displays can publish from the start
	let publish = () => {};
	let setPointerEditor = () => {};

	// An RViz config replaces the displays, fixed frame, background and camera; the widgets
	// (connection, teleop, tools, ...) of the current layout stay as they are.
	const layoutFromRviz = (text) => {
		let doc;
		try {
			doc = parseYaml(text);
		} catch (e) {
			return null;
		}
		if (!isRvizConfig(doc))
			return null;
		const { items, global, camera, skipped } = convertRvizConfig(doc, types);
		const current = registry.toJSON();
		const data = {
			...current,
			global: { ...current.global, ...global },
			ui: camera ? { ...current.ui, camera } : current.ui,
			items: [...current.items.filter((item) => types.get(item.type)?.kind !== "display"), ...items],
		};
		let notice = `Imported ${items.length} display${items.length === 1 ? "" : "s"} from the RViz config.`;
		if (skipped.length)
			notice += ` Not available in Vizanti, so left out: ${skipped.join(", ")}.`;
		return { data, notice };
	};

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

		// layouts saved on the robot
		configs: createConfigClient((url, options) => window.fetch(url, options), base_url),

		saveScreenshot() {
			scene.screenshot().toBlob((blob) => {
				if (!blob) {
					notify("The screenshot could not be created.");
					return;
				}
				const url = URL.createObjectURL(blob);
				const link = document.createElement("a");
				link.href = url;
				link.download = "vizanti_" + new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-") + ".png";
				link.click();
				URL.revokeObjectURL(url);
			}, "image/png");
		},

		// ROS time in seconds: simulation time while /clock is being published, else system time
		time: {
			clock: null,
			clockAt: 0,
			get simulated() { return this.clock !== null && Date.now() - this.clockAt < 2000; },
			now() { return this.simulated ? this.clock + (Date.now() - this.clockAt) / 1000 : Date.now() / 1000; },
		},

		// Returns false when the text is not a layout this version can read.
		importLayout(text) {
			let data;
			let notice = "";
			try {
				data = JSON.parse(text);
			} catch (e) {
				const rviz = layoutFromRviz(text);
				if (!rviz)
					return false;
				({ data, notice } = rviz);
			}
			if (isLegacyLayout(data))
				data = convertLegacyLayout(data, types); // a file exported by the old 2D UI
			if (!isLayout(data))
				return false;
			if (!storage.save(data))
				return false;
			if (notice) {
				try { window.sessionStorage.setItem(NOTICE_KEY, notice); } catch (e) { /* storage blocked */ }
			}
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
	let initial = stored.data;

	// A config saved on the robot: ?config=<name> in the address, or the launch file's
	// default_config for a browser with no layout of its own.
	const launchParams = (await import(`${base_url}/ros_launch_params`)).default;
	const start = startupConfig(window.location.search, !!stored.data, launchParams.default_config ?? "");
	if (start) {
		try {
			let data = await createConfigClient((url, options) => window.fetch(url, options), base_url).load(start.name);
			if (isLegacyLayout(data))
				data = convertLegacyLayout(data, types);
			if (isLayout(data)) {
				initial = data;
				notify(`Started from the config "${start.name}" saved on the robot.`);
			} else {
				notify(`The config "${start.name}" on the robot is not a layout this version can read.`, { sticky: true });
			}
		} catch (e) {
			notify(`The config "${start.name}" could not be loaded from the robot: ${e.message}`, { sticky: true });
		}
		if (start.fromUrl) {
			// applied once: a reload keeps the changes made since
			const url = new URL(window.location.href);
			url.searchParams.delete("config");
			window.history.replaceState(null, "", url);
		}
	}

	// First run of this UI: carry over the layout of the old 2D UI if this browser has one,
	// otherwise start from the server's default config (either format).
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

	try {
		const pending = window.sessionStorage.getItem(NOTICE_KEY);
		if (pending) {
			window.sessionStorage.removeItem(NOTICE_KEY);
			notify(pending, { sticky: true });
		}
	} catch (e) { /* storage blocked */ }

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
	// a template tool removed while it was armed must not leave the camera switched off
	registry.addEventListener("removed", (event) => {
		if (event.detail.item.constructor.kind === "template" && app.tools && app.tools.active === "move")
			scene.setInputEnabled(true);
	});
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

	subscribe("/clock", "rosgraph_msgs/msg/Clock", 100, (msg) => {
		app.time.clock = msg.clock.sec + msg.clock.nanosec * 1e-9;
		app.time.clockAt = Date.now();
	});

	// ---- built-in pointer tools ----

	const publishers = new Map();

	// latched: late subscribers still get the last message (transient local), as for missions
	publish = (topic, type, msg, announce = true, { latched = false } = {}) => {
		const key = topic + "|" + type + (latched ? "|latched" : "");
		if (!publishers.has(key))
			publishers.set(key, new ROSLIB.Topic({ ros: rosbridge.ros, name: topic, messageType: type, latch: latched }));
		publishers.get(key).publish(new ROSLIB.Message(msg));
		if (announce)
			notify(`Published to ${topic}`);
	};

	// What the select tool shows about the object under the pointer.
	const inspect = (x, y) => {
		const hit = scene.pickObject(x, y);
		if (!hit)
			return null;
		let display = null;
		let part = "";
		for (let o = hit.object; o && !display; o = o.parent) {
			if (!part && typeof o.userData.selectLabel === "string")
				part = o.userData.selectLabel;
			display = o.userData.display ?? null;
		}
		const lines = [];
		if (display) {
			lines.push(`${display.name} (${display.constructor.label})`);
			if (display.props.topic)
				lines.push(`Topic: ${display.props.topic}`);
			const frame = display.lastMsg?.header?.frame_id;
			if (frame)
				lines.push(`Frame: ${frame}`);
		} else {
			lines.push("Scene object");
		}
		if (part)
			lines.push(part);
		if (hit.object.isPoints && hit.index !== undefined)
			lines.push(`Point #${hit.index}`);
		const p = hit.point;
		const f = (v) => (Math.abs(v) < 0.0005 ? 0 : v).toFixed(3); // no "-0.000"
		lines.push(`${tf.fixed_frame}: ${f(p.x)}, ${f(p.y)}, ${f(p.z)}`);
		return { point: { x: p.x, y: p.y, z: p.z }, lines, display: display?.id ?? null };
	};

	const tools = new ToolManager({
		pick: (x, y) => scene.pick(x, y),
		inspect,
		ground: (x, y) => scene.groundPoint(x, y),
		focus: (point) => scene.focusOn(point),
		setInputEnabled: (enabled) => scene.setInputEnabled(enabled),
		publish,
		fixedFrame: () => tf.fixed_frame,
		now: () => Date.now(),
		requestRender: () => scene.requestRender(),
	}, registry.ui.tools);
	app.tools = tools;
	tools.onChange = () => {
		sceneElement.style.cursor = tools.active === "move" ? "" : "crosshair";
		window.dispatchEvent(new Event("vizanti_tool_changed"));
	};
	tools.onOptions = (options) => registry.setUi("tools", options);

	for (const [type, kind] of [["pointerdown", "down"], ["pointermove", "move"], ["pointerup", "up"]]) {
		scene.canvas.addEventListener(type, (event) => {
			if (tools.active !== "move")
				tools.pointer(kind, event);
		});
	}

	// A display in edit mode (Waypoints) gets the view's pointer while the Move Camera tool is on:
	// "down" may claim the press (to drag one of its points; the camera then waits), and a press
	// that was not claimed and did not move becomes a "click". Unclaimed drags still move the camera.
	let editor = null;
	let editing = null;
	setPointerEditor = (display) => {
		editor = display;
		editing = null;
		sceneElement.classList.toggle("pointer_editing", !!display);
	};
	const editInfo = (event) => ({
		event,
		ray: scene.ray(event.clientX, event.clientY),
		ground: scene.groundPoint(event.clientX, event.clientY),
	});
	const editorActive = () => editor && editor._alive && editor.enabled && tools.active === "move";
	sceneElement.addEventListener("pointerdown", (event) => {
		if (!editorActive() || event.button !== 0 || !scene.inputEnabled)
			return;
		const claimed = editor._safe("onEditPointer", "down", editInfo(event)) === true;
		editing = { claimed, x: event.clientX, y: event.clientY };
		if (claimed) {
			event.stopImmediatePropagation(); // not the camera, nor the interactive-marker handler
			scene.setInputEnabled(false);
			sceneElement.setPointerCapture?.(event.pointerId);
		}
	}, true);
	sceneElement.addEventListener("pointermove", (event) => {
		if (editing?.claimed && editorActive())
			editor._safe("onEditPointer", "move", editInfo(event));
	});
	const endEdit = (event) => {
		if (!editing)
			return;
		const { claimed, x, y } = editing;
		editing = null;
		if (claimed) {
			scene.setInputEnabled(true);
			if (editorActive())
				editor._safe("onEditPointer", "up", editInfo(event));
		} else if (event.type === "pointerup" && Math.hypot(event.clientX - x, event.clientY - y) < 5 && editorActive()) {
			editor._safe("onEditPointer", "click", editInfo(event));
		}
	};
	sceneElement.addEventListener("pointerup", endEdit);
	sceneElement.addEventListener("pointercancel", endEdit);

	// Interactive objects (interactive markers) take a press that starts on them, before the
	// camera sees it; the camera is paused until the pointer is released.
	let interaction = null;
	sceneElement.addEventListener("pointerdown", (event) => {
		if (tools.active !== "move" || event.button !== 0 || !scene.inputEnabled)
			return;
		const hit = scene.pickInteractive(event.clientX, event.clientY);
		if (!hit)
			return;
		const display = hit.interactive.display;
		const ray = scene.ray(event.clientX, event.clientY);
		if (!display.enabled || !display._safe("onPointer", "down", { ray, hit, event, interactive: hit.interactive }))
			return;
		event.stopPropagation();
		interaction = { display };
		scene.setInputEnabled(false);
		sceneElement.setPointerCapture?.(event.pointerId);
	}, true);
	sceneElement.addEventListener("pointermove", (event) => {
		if (interaction)
			interaction.display._safe("onPointer", "move", { ray: scene.ray(event.clientX, event.clientY), event });
	});
	const release = (event) => {
		if (!interaction)
			return;
		interaction.display._safe("onPointer", "up", { ray: scene.ray(event.clientX, event.clientY), event });
		interaction = null;
		scene.setInputEnabled(true);
	};
	sceneElement.addEventListener("pointerup", release);
	sceneElement.addEventListener("pointercancel", release);
	window.addEventListener("keydown", (event) => {
		const target = event.target;
		if (event.ctrlKey || event.metaKey || event.altKey)
			return;
		if (target && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)))
			return;
		tools.key(event.key);
	});

	// what the active tool is doing, drawn over the view
	scene.addOverlayDrawer((ctx, view) => {
		const at = (p) => view.project(p.x, p.y, p.z);
		if (tools.active !== "move") {
			const hint = TOOLS.find((tool) => tool.id === tools.active).hint + "  (Esc to cancel)";
			ctx.font = "13px Monospace";
			ctx.textAlign = "center";
			ctx.lineWidth = 4;
			ctx.strokeStyle = "#161B21";
			ctx.fillStyle = "white";
			ctx.strokeText(hint, view.width / 2, 22);
			ctx.fillText(hint, view.width / 2, 22);
		}

		const m = tools.measurement;
		if (m) {
			const a = at(m.a), b = at(m.b);
			ctx.strokeStyle = "#ffd23f";
			ctx.fillStyle = "#ffd23f";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.moveTo(a.x, a.y);
			ctx.lineTo(b.x, b.y);
			ctx.stroke();
			for (const p of [a, b]) {
				ctx.beginPath();
				ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
				ctx.fill();
			}
			const label = formatDistance(m.distance);
			ctx.font = "bold 15px Monospace";
			ctx.textAlign = "center";
			ctx.lineWidth = 4;
			ctx.strokeStyle = "#161B21";
			ctx.strokeText(label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 10);
			ctx.fillText(label, (a.x + b.x) / 2, (a.y + b.y) / 2 - 10);
		}

		const selected = tools.selection;
		if (selected) {
			const p = at(selected.point);
			ctx.strokeStyle = "#00e5ff";
			ctx.lineWidth = 2;
			ctx.beginPath();
			ctx.arc(p.x, p.y, 7, 0, 2 * Math.PI);
			ctx.stroke();

			ctx.font = "12px Monospace";
			ctx.textAlign = "left";
			const pad = 6, lineHeight = 16;
			const width = Math.max(...selected.lines.map((line) => ctx.measureText(line).width)) + 2 * pad;
			const height = selected.lines.length * lineHeight + pad;
			// beside the point, kept inside the view
			const x = Math.min(p.x + 12, view.width - width - 4);
			const y = Math.min(Math.max(p.y - height / 2, 30), view.height - height - 4);
			ctx.fillStyle = "rgba(22, 27, 33, 0.85)";
			ctx.fillRect(x, y, width, height);
			ctx.strokeRect(x, y, width, height);
			ctx.fillStyle = "white";
			selected.lines.forEach((line, i) => ctx.fillText(line, x + pad, y + pad + 10 + i * lineHeight));
		}

		const pose = tools.preview;
		if (pose) {
			// an arrow about 70 px long on the ground, from the pressed point along the heading
			const length = 70 / view.pixelsPerMeter();
			const tail = at(pose.start);
			const tip = at({ x: pose.start.x + Math.cos(pose.yaw) * length, y: pose.start.y + Math.sin(pose.yaw) * length, z: 0 });
			const angle = Math.atan2(tip.y - tail.y, tip.x - tail.x);
			ctx.strokeStyle = tools.active === "goal" ? "#b04cff" : "#2ecc71";
			ctx.fillStyle = ctx.strokeStyle;
			ctx.lineWidth = 5;
			ctx.beginPath();
			ctx.moveTo(tail.x, tail.y);
			ctx.lineTo(tip.x, tip.y);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(tip.x + 14 * Math.cos(angle), tip.y + 14 * Math.sin(angle));
			ctx.lineTo(tip.x + 10 * Math.cos(angle + 2.4), tip.y + 10 * Math.sin(angle + 2.4));
			ctx.lineTo(tip.x + 10 * Math.cos(angle - 2.4), tip.y + 10 * Math.sin(angle - 2.4));
			ctx.fill();
		}
	});
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
