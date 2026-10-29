import * as THREE from '../lib/three.module.min.js';
import { makeArrow, disposeObject } from './arrow.js';
import { buildMarker } from '../geometry/markers.js';
import { normalizeQuat } from '../geometry/shapes.js';
import { INTERACTION, FEEDBACK, closestParamOnLine, rayPlane, signedAngle, autoControls, axisColor } from '../geometry/interaction.js';

const v3 = (v) => ({ x: v.x, y: v.y, z: v.z });

// Interactive markers (visualization_msgs/InteractiveMarker) in the 3D view: their controls drawn
// (with arrows and rings for controls that bring no markers of their own) and dragged, turned or
// clicked with the pointer. Who owns them decides what a drag means:
//   onFeedback(entry, controlIndex, event, extra)  FEEDBACK.MOUSE_DOWN / POSE_UPDATE / BUTTON_CLICK / MOUSE_UP
//   onMenu(entry, controlIndex, event, mousePoint) a click on a control with menu entries
// The Interactive Markers display sends these to an interactive_markers server; MoveIt's
// MotionPlanning display turns them into inverse kinematics.
//
// The owning display must pass its onPointer(kind, args) to handles.onPointer.
export class MarkerHandles {

	constructor(display, { onFeedback = () => {}, onMenu = () => {}, showAxes = false } = {}) {
		this.display = display;
		this.onFeedback = onFeedback;
		this.onMenu = onMenu;
		this.showAxes = showAxes;
		this.markers = new Map(); // name -> { msg, frame, frameGroup, poseGroup, axes, attached }
		this.drag = null;
		this.lastFeedback = 0;
		this.visible = true;
	}

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
		const ctx = this.display.ctx;
		const node = ctx.frames.get(entry.frame || ctx.tf.fixed_frame);
		if (node) {
			node.add(entry.frameGroup);
			entry.attached = true;
		} else {
			entry.frameGroup.removeFromParent();
			entry.attached = false;
		}
	}

	// TF changed: markers whose frame was missing may have one now
	attachMissing() {
		for (const entry of this.markers.values()) {
			if (!entry.attached)
				this.attach(entry);
		}
	}

	attachAll() {
		for (const entry of this.markers.values())
			this.attach(entry);
	}

	setVisible(visible) {
		this.visible = visible;
		for (const entry of this.markers.values())
			entry.frameGroup.visible = visible;
	}

	setShowAxes(show) {
		this.showAxes = show;
		for (const entry of this.markers.values())
			entry.axes.visible = show;
	}

	setMarker(msg) {
		this.removeMarker(msg.name);
		const display = this.display;
		const entry = {
			msg,
			frame: msg.header.frame_id,
			frameGroup: new THREE.Group(),
			poseGroup: new THREE.Group(),
		};
		entry.frameGroup.add(entry.poseGroup);
		entry.frameGroup.visible = this.visible;
		const scale = msg.scale > 0 ? msg.scale : 1;

		msg.controls.forEach((control, index) => {
			const group = new THREE.Group();
			const interactive = { display, marker: msg.name, control: index };
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
				object.renderOrder = display.order;
			});
			entry.poseGroup.add(group);
		});

		entry.axes = new THREE.AxesHelper(scale);
		entry.axes.visible = this.showAxes;
		entry.poseGroup.add(entry.axes);

		this.placePose(entry, msg.pose);
		this.attach(entry);
		this.markers.set(msg.name, entry);
		return entry;
	}

	// the marker's pose in its own frame, as a geometry_msgs/Pose
	poseOf(entry) {
		const p = entry.poseGroup.position, q = entry.poseGroup.quaternion;
		return { position: v3(p), orientation: { x: q.x, y: q.y, z: q.z, w: q.w } };
	}

	// ---- interaction (the owning display's onPointer, for presses that start on a marker) ----

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
			this.onFeedback(entry, interactive.control, FEEDBACK.MOUSE_DOWN, { mousePoint: v3(hit.point) });
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
			this.onFeedback(entry, controlIndex, FEEDBACK.POSE_UPDATE, {});
		} else if (!moved && mode === INTERACTION.BUTTON) {
			this.onFeedback(entry, controlIndex, FEEDBACK.BUTTON_CLICK, { mousePoint: drag.mouse });
		} else if (!moved && (mode === INTERACTION.MENU || entry.msg.menu_entries?.length) && entry.msg.menu_entries?.length) {
			this.onMenu(entry, controlIndex, event, drag.mouse);
		}
		this.onFeedback(entry, controlIndex, FEEDBACK.MOUSE_UP, { mousePoint: drag.mouse });
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
		this.display.requestRender();
		return true;
	}

	throttledPoseUpdate() {
		const now = Date.now();
		if (now - this.lastFeedback < 50)
			return;
		this.lastFeedback = now;
		this.onFeedback(this.drag.entry, this.drag.controlIndex, FEEDBACK.POSE_UPDATE, {});
	}
}
