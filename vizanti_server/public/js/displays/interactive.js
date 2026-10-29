import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { MarkerHandles } from '../core/marker_handles.js';
import { stampNow } from '../core/tools.js';
import { FEEDBACK, feedbackMessage } from '../geometry/interaction.js';

const CLIENT_ID = "vizanti_" + Math.random().toString(36).slice(2, 8);

// Interactive markers served by an interactive_markers server: drawn in 3D, and dragged,
// rotated, clicked or given menu choices with the mouse in the Move Camera tool.
export class InteractiveMarkersDisplay extends Display {

	static type = "interactivemarkers";
	static label = "Interactive Markers";
	static icon = "assets/markerarray.svg";
	static description = "visualization_msgs/InteractiveMarker, from an interactive_markers server";
	static msgTypes = ["visualization_msgs/msg/InteractiveMarkerUpdate"];

	static properties = {
		namespace: {
			type: "string", label: "Server namespace",
			help: "The name the interactive marker server was created with, e.g. /basic_controls. Vizanti reads <namespace>/update and publishes <namespace>/feedback.",
		},
		show_descriptions: { type: "bool", label: "Show descriptions", default: true },
		show_axes: { type: "bool", label: "Show axes", default: false },
	};

	static propsForTopic(topic) {
		return { namespace: topic.replace(/\/update(_full)?$/, "") };
	}

	get iconColor() {
		return null;
	}

	onCreate() {
		this.handles = new MarkerHandles(this, {
			onFeedback: (entry, controlIndex, event, extra) => this.sendFeedback(entry, controlIndex, event, extra),
			onMenu: (entry, controlIndex, event, mousePoint) => this.openMenu(entry, controlIndex, event, mousePoint),
			showAxes: this.props.show_axes,
		});
		this.markers = this.handles.markers; // name -> { msg, frameGroup, poseGroup, axes }
		this.connect();
	}

	// ---- connection ----

	disconnect() {
		if (this.updateUnsub) {
			this.updateUnsub();
			this.updateUnsub = null;
		}
	}

	connect() {
		this.disconnect();
		this.clear();
		const ns = this.props.namespace.replace(/\/$/, "");
		if (!ns || !this.enabled) {
			if (!ns)
				this.status.error("No server namespace set.");
			return;
		}
		this.status.warn("Waiting for the interactive marker server...");
		const generation = (this.generation = (this.generation ?? 0) + 1);

		this.updateUnsub = this.ctx.subscribe(`${ns}/update`, "visualization_msgs/msg/InteractiveMarkerUpdate", 0, (msg) => {
			if (generation === this.generation)
				this._safe("applyUpdate", msg);
		});

		// the full current set comes from the server's service
		this.ctx.callService(`${ns}/get_interactive_markers`, "visualization_msgs/srv/GetInteractiveMarkers", {})
			.then((response) => {
				if (generation !== this.generation || !this._alive)
					return;
				for (const marker of response.markers ?? [])
					this.handles.setMarker(marker);
				this.report();
			})
			.catch((e) => {
				if (generation === this.generation)
					this.status.error(`The interactive marker server at "${ns}" did not answer: ${e.message}`);
			});
	}

	report() {
		this.setInfo({ "Server": this.props.namespace, "Markers": this.markers.size });
		if (this.status.level !== "error")
			this.status.ok();
	}

	applyUpdate(msg) {
		for (const marker of msg.markers ?? [])
			this.handles.setMarker(marker);
		for (const pose of msg.poses ?? []) {
			const entry = this.markers.get(pose.name);
			if (entry && this.handles.drag?.name !== pose.name)
				this.handles.placePose(entry, pose.pose, pose.header);
		}
		for (const name of msg.erases ?? [])
			this.handles.removeMarker(name);
		if (msg.type === 1)
			this.report();
		this.requestRender();
	}

	clear() {
		this.handles.clear();
	}

	onTfChange() {
		this.handles.attachMissing();
	}

	onFixedFrameChange() {
		this.handles.attachAll();
	}

	_setEnabled(enabled) {
		super._setEnabled(enabled);
		this.handles.setVisible(enabled);
	}

	onPropertyChange(key) {
		if (key === "namespace")
			this.connect();
		if (key === "show_axes")
			this.handles.setShowAxes(this.props.show_axes);
		this.requestRender();
	}

	onDestroy() {
		clearTimeout(this.feedbackTimer);
		this.disconnect();
		this.closeMenu();
		this.clear();
	}

	onOverlay(ctx, scene) {
		if (!this.props.show_descriptions)
			return;
		const position = new THREE.Vector3();
		ctx.font = "13px Monospace";
		ctx.textAlign = "center";
		ctx.lineWidth = 4;
		ctx.strokeStyle = "#161B21";
		ctx.fillStyle = "white";
		for (const entry of this.markers.values()) {
			const text = entry.msg.description;
			if (!text || !entry.attached)
				continue;
			entry.poseGroup.getWorldPosition(position);
			const scale = entry.msg.scale > 0 ? entry.msg.scale : 1;
			const p = scene.project(position.x, position.y, position.z + scale * 0.7);
			if (!p.visible)
				continue;
			ctx.strokeText(text, p.x, p.y);
			ctx.fillText(text, p.x, p.y);
		}
	}

	// ---- interaction (called by the app for pointer events that start on one of our objects) ----

	// Interactive marker servers usually subscribe to feedback with a queue of one, so a press,
	// click and release sent together would lose all but the last. They are spaced out instead.
	queueFeedback(topic, message) {
		this.feedbackQueue ??= [];
		this.feedbackQueue.push([topic, message]);
		if (this.feedbackTimer)
			return;
		const next = () => {
			const item = this.feedbackQueue.shift();
			if (!item) {
				this.feedbackTimer = null;
				return;
			}
			this.ctx.publish(item[0], "visualization_msgs/msg/InteractiveMarkerFeedback", item[1]);
			this.feedbackTimer = setTimeout(next, 40);
		};
		next();
	}

	sendFeedback(entry, controlIndex, event, extra = {}) {
		const control = entry.msg.controls[controlIndex];
		this.queueFeedback(`${this.props.namespace.replace(/\/$/, "")}/feedback`, feedbackMessage({
			frame: entry.frame || this.ctx.tf.fixed_frame,
			stamp: stampNow(Date.now()),
			clientId: CLIENT_ID,
			marker: entry.msg.name,
			control: control?.name ?? "",
			event,
			pose: this.handles.poseOf(entry),
			...extra,
		}));
	}

	onPointer(kind, args) {
		return this.handles.onPointer(kind, args);
	}

	// ---- context menu ----

	closeMenu() {
		if (this.menu) {
			this.menu.remove();
			this.menu = null;
		}
	}

	openMenu(entry, controlIndex, event, mousePoint) {
		this.closeMenu();
		const menu = document.createElement("div");
		menu.className = "im_menu";
		menu.style.left = event.clientX + "px";
		menu.style.top = event.clientY + "px";

		const entries = entry.msg.menu_entries;
		const add = (parent, depth) => {
			for (const item of entries.filter((e) => e.parent_id === parent)) {
				const row = document.createElement("div");
				row.className = "im_menu_item";
				row.style.paddingLeft = (8 + depth * 14) + "px";
				row.textContent = item.title;
				const hasChildren = entries.some((e) => e.parent_id === item.id);
				if (hasChildren) {
					row.classList.add("im_menu_group");
				} else {
					row.addEventListener("click", () => {
						this.sendFeedback(entry, controlIndex, FEEDBACK.MENU_SELECT, { menuEntry: item.id, mousePoint });
						this.closeMenu();
					});
				}
				menu.appendChild(row);
				add(item.id, depth + 1);
			}
		};
		add(0, 0);
		document.body.appendChild(menu);
		this.menu = menu;
		// any click elsewhere closes it
		setTimeout(() => document.addEventListener("pointerdown", (e) => {
			if (!menu.contains(e.target))
				this.closeMenu();
		}, { once: true }), 0);
	}
}
