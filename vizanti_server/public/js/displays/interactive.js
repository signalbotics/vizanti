import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { makeArrow, disposeObject } from '../core/arrow.js';
import { buildMarker } from '../geometry/markers.js';
import { normalizeQuat } from '../geometry/shapes.js';
import { stampNow } from '../core/tools.js';
import {
	INTERACTION, FEEDBACK, closestParamOnLine, rayPlane, signedAngle, autoControls, axisColor, feedbackMessage,
} from '../geometry/interaction.js';

const CLIENT_ID = "vizanti_" + Math.random().toString(36).slice(2, 8);
const v3 = (v) => ({ x: v.x, y: v.y, z: v.z });

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
		this.markers = new Map(); // name -> { msg, frameGroup, poseGroup, axes }
		this.drag = null;
		this.lastFeedback = 0;
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
					this.setMarker(marker);
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
			this.setMarker(marker);
		for (const pose of msg.poses ?? []) {
			const entry = this.markers.get(pose.name);
			if (entry && this.drag?.name !== pose.name)
				this.placePose(entry, pose.pose, pose.header);
		}
		for (const name of msg.erases ?? [])
			this.removeMarker(name);
		if (msg.type === 1)
			this.report();
		this.requestRender();
	}

	// ---- building ----

	clear() {
		for (const name of [...this.markers.keys()])
			this.removeMarker(name);
	}

	removeMarker(name) {
		const entry = this.markers.get(name);
		if (!entry)
			return;
		entry.frameGroup.removeFromParent();
		disposeObject(entry.frameGroup);
		this.markers.delete(name);
	}

	placePose(entry, pose, header) {
		if (header && header.frame_id && header.frame_id !== entry.frame) {
			entry.frame = header.frame_id;
			this.attach(entry);
		}
		entry.poseGroup.position.set(pose.position.x, pose.position.y, pose.position.z);
		const q = normalizeQuat(pose.orientation);
		entry.poseGroup.quaternion.set(q.x, q.y, q.z, q.w);
	}

	// markers hang off their frame's node, so they follow TF
	attach(entry) {
		const node = this.ctx.frames.get(entry.frame || this.ctx.tf.fixed_frame);
		if (node) {
			node.add(entry.frameGroup);
			entry.attached = true;
		} else {
			entry.frameGroup.removeFromParent();
			entry.attached = false;
		}
	}

	setMarker(msg) {
		this.removeMarker(msg.name);
		const entry = {
			msg,
			frame: msg.header.frame_id,
			frameGroup: new THREE.Group(),
			poseGroup: new THREE.Group(),
		};
		entry.frameGroup.add(entry.poseGroup);
		entry.frameGroup.visible = this.enabled;
		const scale = msg.scale > 0 ? msg.scale : 1;

		msg.controls.forEach((control, index) => {
			const group = new THREE.Group();
			const interactive = { display: this, marker: msg.name, control: index };
			const orientation = normalizeQuat(control.orientation);
			const controlQuat = new THREE.Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);

			for (const marker of control.markers ?? []) {
				const built = buildMarker({ ...marker, pose: marker.pose ?? { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } } });
				group.add(built.object);
			}

			// handles for controls that bring none
			const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(controlQuat);
			const [r, g, b] = axisColor(axis);
			for (const handle of autoControls(control)) {
				const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide });
				let object;
				if (handle.kind === "arrow") {
					object = makeArrow(0.5 * scale, 0.04 * scale, 0.09 * scale, 0.18 * scale, material);
					object.position.x = handle.direction * 0.5 * scale;
					if (handle.direction < 0)
						object.rotation.z = Math.PI;
				} else {
					// a ring in the plane normal to the control's x axis
					object = new THREE.Mesh(new THREE.TorusGeometry(0.6 * scale, 0.035 * scale, 12, 48).rotateY(Math.PI / 2), material);
				}
				const holder = new THREE.Group();
				holder.quaternion.copy(controlQuat);
				holder.add(object);
				group.add(holder);
			}

			group.traverse((object) => {
				object.userData.interactive = interactive;
				object.renderOrder = this.order;
			});
			entry.poseGroup.add(group);
		});

		entry.axes = new THREE.AxesHelper(scale);
		entry.axes.visible = this.props.show_axes;
		entry.poseGroup.add(entry.axes);

		this.placePose(entry, msg.pose);
		this.attach(entry);
		this.markers.set(msg.name, entry);
	}

	onTfChange() {
		for (const entry of this.markers.values()) {
			if (!entry.attached)
				this.attach(entry);
		}
	}

	onFixedFrameChange() {
		for (const entry of this.markers.values())
			this.attach(entry);
	}

	_setEnabled(enabled) {
		super._setEnabled(enabled);
		for (const entry of this.markers.values())
			entry.frameGroup.visible = enabled;
	}

	onPropertyChange(key) {
		if (key === "namespace")
			this.connect();
		if (key === "show_axes") {
			for (const entry of this.markers.values())
				entry.axes.visible = this.props.show_axes;
		}
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
		const p = entry.poseGroup.position, q = entry.poseGroup.quaternion;
		this.queueFeedback(`${this.props.namespace.replace(/\/$/, "")}/feedback`, feedbackMessage({
			frame: entry.frame || this.ctx.tf.fixed_frame,
			stamp: stampNow(Date.now()),
			clientId: CLIENT_ID,
			marker: entry.msg.name,
			control: control?.name ?? "",
			event,
			pose: { position: v3(p), orientation: { x: q.x, y: q.y, z: q.z, w: q.w } },
			...extra,
		}));
	}

	onPointer(kind, { ray, hit, event, interactive }) {
		if (kind === "down") {
			const entry = this.markers.get(interactive.marker);
			if (!entry)
				return false;
			const control = entry.msg.controls[interactive.control];
			const mode = control.interaction_mode;
			const world = new THREE.Vector3(), worldQuat = new THREE.Quaternion();
			entry.poseGroup.getWorldPosition(world);
			entry.poseGroup.getWorldQuaternion(worldQuat);
			const o = normalizeQuat(control.orientation);
			const axis = new THREE.Vector3(1, 0, 0)
				.applyQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w))
				.applyQuaternion(worldQuat);
			const planeNormal = mode === INTERACTION.MOVE_3D || mode === INTERACTION.MOVE_ROTATE_3D
				? ray.direction.clone().negate()
				: axis.clone();
			this.drag = {
				name: entry.msg.name,
				entry, controlIndex: interactive.control, mode, axis,
				planeNormal,
				startWorld: world.clone(),
				startQuat: worldQuat.clone(),
				startParam: closestParamOnLine(ray.origin, ray.direction, world, axis),
				startHit: rayPlane(ray.origin, ray.direction, world, planeNormal) ?? v3(hit.point),
				moved: false,
				mouse: v3(hit.point),
				clientX: event.clientX,
				clientY: event.clientY,
			};
			this.sendFeedback(entry, interactive.control, FEEDBACK.MOUSE_DOWN, { mousePoint: v3(hit.point) });
			return true;
		}

		const drag = this.drag;
		if (!drag)
			return false;

		if (kind === "move") {
			if (Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) > 3)
				drag.moved = true;
			if (this.dragTo(ray))
				this.throttledPoseUpdate();
			return true;
		}

		// up
		const { entry, controlIndex, mode, moved } = drag;
		if (moved && this.movable(mode)) {
			this.sendFeedback(entry, controlIndex, FEEDBACK.POSE_UPDATE);
		} else if (!moved && mode === INTERACTION.BUTTON) {
			this.sendFeedback(entry, controlIndex, FEEDBACK.BUTTON_CLICK, { mousePoint: drag.mouse });
		} else if (!moved && (mode === INTERACTION.MENU || entry.msg.menu_entries?.length) && entry.msg.menu_entries?.length) {
			this.openMenu(entry, controlIndex, event, drag.mouse);
		}
		this.sendFeedback(entry, controlIndex, FEEDBACK.MOUSE_UP, { mousePoint: drag.mouse });
		this.drag = null;
		return true;
	}

	movable(mode) {
		return [INTERACTION.MOVE_AXIS, INTERACTION.MOVE_PLANE, INTERACTION.ROTATE_AXIS, INTERACTION.MOVE_ROTATE,
			INTERACTION.MOVE_3D, INTERACTION.MOVE_ROTATE_3D].includes(mode);
	}

	// moves or turns the marker to follow the pointer; true when it changed
	dragTo(ray) {
		const drag = this.drag;
		const entry = drag.entry;
		let world = drag.startWorld.clone();
		let quat = drag.startQuat.clone();

		if (drag.mode === INTERACTION.MOVE_AXIS) {
			const t = closestParamOnLine(ray.origin, ray.direction, drag.startWorld, drag.axis);
			if (t === null || drag.startParam === null)
				return false;
			world.addScaledVector(drag.axis, t - drag.startParam);
		} else if (drag.mode === INTERACTION.ROTATE_AXIS) {
			const p = rayPlane(ray.origin, ray.direction, drag.startWorld, drag.axis);
			if (!p)
				return false;
			const a = new THREE.Vector3().subVectors(drag.startHit, drag.startWorld);
			const b = new THREE.Vector3().subVectors(p, drag.startWorld);
			const angle = signedAngle(a, b, drag.axis);
			quat = new THREE.Quaternion().setFromAxisAngle(drag.axis.clone().normalize(), angle).multiply(drag.startQuat);
		} else if (this.movable(drag.mode)) {
			const p = rayPlane(ray.origin, ray.direction, drag.startWorld, drag.planeNormal);
			if (!p)
				return false;
			world.add(new THREE.Vector3().subVectors(p, drag.startHit));
		} else {
			return false;
		}

		// back into the marker's own frame
		const parent = entry.frameGroup;
		parent.updateWorldMatrix(true, false);
		const local = parent.worldToLocal(world.clone());
		const parentQuat = new THREE.Quaternion();
		parent.getWorldQuaternion(parentQuat);
		const localQuat = parentQuat.invert().multiply(quat);
		entry.poseGroup.position.copy(local);
		entry.poseGroup.quaternion.copy(localQuat);
		drag.mouse = v3(world);
		this.requestRender();
		return true;
	}

	throttledPoseUpdate() {
		const now = Date.now();
		if (now - this.lastFeedback < 50)
			return;
		this.lastFeedback = now;
		this.sendFeedback(this.drag.entry, this.drag.controlIndex, FEEDBACK.POSE_UPDATE);
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
