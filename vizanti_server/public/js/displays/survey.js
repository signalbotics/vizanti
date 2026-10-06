import * as THREE from '../lib/three.module.min.js';
import { PointEditorDisplay } from '../core/point_editor.js';
import { waypointPoses } from '../geometry/waypoints.js';
import { insertIndexClosed, autoSpacing, fromLegacySurvey } from '../geometry/survey.js';

const MARKER_NAMES = ["ST", "FIN"];

const button = (text, title, onClick) => {
	const element = document.createElement("button");
	element.type = "button";
	element.textContent = text;
	element.title = title;
	element.addEventListener("click", onClick);
	return element;
};

// A survey polygon edited in the 3D view, filled with a lawnmower coverage path (generated in a
// worker) and sent as nav_msgs/Path or geometry_msgs/PoseArray. Replaces the old 2D "survey"
// widget and carries over its saved surveys.
export class SurveyDisplay extends PointEditorDisplay {

	static type = "survey";
	static label = "Survey";
	static icon = "assets/survey.svg";
	static description = "Draw a polygon and send a lawnmower coverage path across it";

	static properties = {
		mission_topic: { type: "string", label: "Topic", default: "/waypoints", help: "Where the coverage path is published (latched)." },
		message_type: {
			type: "enum", label: "Message type", default: "nav_msgs/msg/Path",
			options: [
				{ value: "nav_msgs/msg/Path", label: "nav_msgs/Path" },
				{ value: "geometry_msgs/msg/PoseArray", label: "geometry_msgs/PoseArray" },
			],
		},
		frame: { type: "frame", label: "Survey frame", help: "The polygon and path are kept and sent in this frame (the fixed frame when empty)." },
		robot_frame: { type: "frame", label: "Robot frame", default: "base_link", noDefault: true, help: "The start (ST) and finish (FIN) markers are first placed beside it." },
		pattern: {
			type: "group", label: "Pattern", properties: {
				spacing: { type: "float", label: "Line spacing (m)", default: 2, min: 0.05, max: 1000, step: 0.1 },
				angle: { type: "float", label: "Line angle (°)", default: 0, min: -180, max: 180, step: 1, help: "Relative to East / the frame's X axis." },
				turnaround: { type: "float", label: "Turnaround (m)", default: 2, min: 0, max: 1000, step: 0.1, help: "Extra distance outside the area for turning between lines." },
				crosshatch: { type: "bool", label: "Repeat at 90° (criss-cross)", default: false },
				direct_transit: {
					type: "bool", label: "Direct transits across gaps", default: false,
					help: "By default, moves between lines follow the area's edge, since the outside can't be assumed clear and cutting across the survey is avoided. This connects them directly instead.",
				},
			},
		},
		color: { type: "color", label: "Area colour", default: "#4fd68a" },
		path_color: { type: "color", label: "Path colour", default: "#ffd23f" },
		polygon: { type: "array" },
		markers: { type: "array" }, // [start, finish], placed once the polygon has 3 vertices
	};

	static migrateProps(props) {
		return props.state && typeof props.state === "object" ? fromLegacySurvey(props.state) : props;
	}

	static fromLegacy(state) {
		return fromLegacySurvey(state);
	}

	onCreate() {
		const scene = this.ctx.scene;
		this.mode = "idle"; // "idle" | "xy" | "z"
		this.drag = null;
		this.result = { points: [], labels: [], error: null };
		this.seq = 0;
		this.material = new THREE.MeshLambertMaterial({ color: this.props.color });
		this.markerMaterials = [new THREE.MeshLambertMaterial({ color: "#2ecc71" }), new THREE.MeshLambertMaterial({ color: "#ff6b6b" })];
		this.vertices = new THREE.Group();
		this.outline = scene.makeLines({ color: this.props.color, linewidth: 3 });
		this.pathLines = scene.makeLines({ color: this.props.path_color, linewidth: 2 });
		this.add(this.vertices);
		this.add(this.outline);
		this.add(this.pathLines);
		try {
			this.worker = new Worker(new URL("../workers/survey_worker.js", import.meta.url));
			this.worker.onmessage = (event) => this.onSurvey(event.data);
		} catch (e) {
			this.worker = null;
			this.status.error("The survey planner could not start in this browser.");
		}
		this.place();
		this.redraw();
		this.plan();
	}

	polygon() {
		return Array.isArray(this.props.polygon) ? this.props.polygon : [];
	}

	markers() {
		return Array.isArray(this.props.markers) && this.props.markers.length === 2 ? this.props.markers : [];
	}

	// ---- planning (in the worker) ----

	plan() {
		const polygon = this.polygon(), markers = this.markers();
		if (!this.worker || polygon.length < 3 || markers.length !== 2) {
			this.result = { points: [], labels: [], error: null };
			this.redraw();
			return;
		}
		this.worker.postMessage({
			seq: ++this.seq,
			polygon, start_marker: markers[0], end_marker: markers[1],
			spacing: Math.max(this.props.spacing, 0.05),
			angle: this.props.angle * Math.PI / 180,
			turnaround: Math.max(this.props.turnaround, 0),
			crosshatch: this.props.crosshatch,
			direct_transit: this.props.direct_transit,
		});
	}

	onSurvey(data) {
		if (!this._alive || data.seq !== this.seq)
			return; // an older request
		this.result = { points: data.survey_points ?? [], labels: data.transect_labels ?? [], error: data.error };
		if (data.error)
			this.status.error(data.error);
		else
			this.status.ok();
		this.redraw();
	}

	// After an edit: once there are three vertices, place ST/FIN beside the robot and size the
	// line spacing for about ten lines (as the old widget did); then plan again.
	edited(polygon, { autosize = false } = {}) {
		const props = { polygon: polygon.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })) };
		let spacing = this.props.spacing;
		if (autosize && polygon.length >= 3) {
			spacing = autoSpacing(polygon, this.props.angle * Math.PI / 180, spacing, this.props.crosshatch);
			if (spacing !== this.props.spacing) {
				props.spacing = spacing;
				props.turnaround = spacing;
			}
		}
		if (polygon.length >= 3 && this.markers().length !== 2) {
			// beside the robot, one line spacing either side (after any auto-sizing, as before)
			const robot = this.robotLocal(this.props.robot_frame) ?? { x: 0, y: 0, z: 0 };
			const offset = Math.max(spacing, 0.05);
			props.markers = [{ x: robot.x - offset, y: robot.y, z: robot.z ?? 0 }, { x: robot.x + offset, y: robot.y, z: robot.z ?? 0 }];
		}
		for (const [key, value] of Object.entries(props))
			this.setProp(key, value);
		this.redraw();
		this.plan();
		this.paintEditor();
	}

	// ---- drawing ----

	redraw() {
		const scene = this.ctx.scene;
		const polygon = this.polygon(), markers = this.markers();
		for (const child of [...this.vertices.children]) {
			child.geometry.dispose();
			this.vertices.remove(child);
		}
		const sphere = (p, material, radius) => {
			const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 14, 10), material);
			mesh.position.set(p.x, p.y, p.z ?? 0);
			mesh.renderOrder = this.order;
			this.vertices.add(mesh);
		};
		polygon.forEach((p) => sphere(p, this.material, 0.1));
		markers.forEach((p, i) => sphere(p, this.markerMaterials[i], 0.16));

		const outline = [];
		if (polygon.length >= 2) {
			const closed = polygon.length >= 3 ? [...polygon, polygon[0]] : polygon;
			for (let i = 0; i + 1 < closed.length; i++)
				outline.push(closed[i].x, closed[i].y, closed[i].z ?? 0, closed[i + 1].x, closed[i + 1].y, closed[i + 1].z ?? 0);
		}
		scene.setLinePositions(this.outline, outline);

		const path = [];
		const points = this.result.points;
		for (let i = 0; i + 1 < points.length; i++)
			path.push(points[i].x, points[i].y, (points[i].z ?? 0) + 0.02, points[i + 1].x, points[i + 1].y, (points[i + 1].z ?? 0) + 0.02);
		scene.setLinePositions(this.pathLines, path);

		let length = 0;
		for (let i = 0; i + 1 < points.length; i++)
			length += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
		this.setInfo({
			"Vertices": polygon.length,
			"Lines": this.result.labels.length,
			"Path": points.length ? `${points.length} waypoints, ${length.toFixed(1)} m` : "none",
		});
		this.requestRender();
	}

	onOverlay(ctx, scene) {
		ctx.font = "bold 12px system-ui, sans-serif";
		ctx.lineWidth = 3;
		ctx.strokeStyle = "#161B21";
		const label = (p, text, color, dx = 10, dy = -10) => {
			const s = this.screenOf(p);
			if (!s.visible)
				return;
			ctx.fillStyle = color;
			ctx.strokeText(text, s.x + dx, s.y + dy);
			ctx.fillText(text, s.x + dx, s.y + dy);
		};
		ctx.textAlign = "left";
		this.markers().forEach((p, i) => label(p, MARKER_NAMES[i], i === 0 ? "#2ecc71" : "#ff6b6b"));
		if (this.mode === "z")
			this.polygon().forEach((p) => label(p, `z=${(p.z ?? 0).toFixed(2)}`, "#ffffff"));
		ctx.textAlign = "center";
		this.result.labels.forEach((p, i) => label({ x: p.x, y: p.y, z: 0 }, String(i + 1), this.props.path_color, 0, 4));
	}

	// ---- editing in the view ----

	setMode(mode) {
		this.mode = this.mode === mode ? "idle" : mode;
		this.drag = null;
		this.ctx.setPointerEditor?.(this.mode === "idle" ? null : this);
		this.redraw();
		this.paintEditor();
	}

	onEditPointer(kind, { event, ground }) {
		if (kind === "down") {
			// markers first: they sit on top and cannot be deleted
			const marker = this.mode === "xy" ? this.hitIndex(this.markers(), event) : -1;
			const vertex = marker === -1 ? this.hitIndex(this.polygon(), event) : -1;
			if (marker === -1 && vertex === -1)
				return false;
			const target = marker !== -1 ? { list: "markers", index: marker } : { list: "polygon", index: vertex };
			const startZ = target.list === "polygon" ? (this.polygon()[vertex].z ?? 0) : 0;
			this.drag = { ...target, startX: event.clientX, startY: event.clientY, startZ, moved: false };
			return true;
		}
		if (kind === "move" && this.drag) {
			const list = (this.drag.list === "markers" ? this.markers() : this.polygon()).map((p) => ({ ...p }));
			const p = list[this.drag.index];
			if (this.mode === "z") {
				p.z = this.drag.startZ + (this.drag.startY - event.clientY) * this.metersPerPixel();
			} else if (ground) {
				const local = this.toLocal(ground);
				p.x = event.shiftKey ? Math.round(local.x * 2) / 2 : local.x;
				p.y = event.shiftKey ? Math.round(local.y * 2) / 2 : local.y;
			}
			this.drag.moved = this.drag.moved || Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 3;
			this.props[this.drag.list] = list; // live; saved and re-planned on release
			this.redraw();
			return true;
		}
		if (kind === "up" && this.drag) {
			const { list, index, moved } = this.drag;
			this.drag = null;
			if (list === "polygon") {
				const polygon = this.polygon().map((p) => ({ ...p }));
				if (!moved && this.mode === "xy")
					polygon.splice(index, 1); // a tap on a vertex deletes it
				this.edited(polygon);
			} else {
				this.setProp("markers", this.markers().map((p) => ({ ...p })));
				this.plan();
			}
			return true;
		}
		if (kind === "click" && this.mode === "xy" && ground) {
			const local = this.toLocal(ground);
			const polygon = this.polygon().map((p) => ({ ...p }));
			const before = polygon.length;
			polygon.splice(insertIndexClosed(polygon, local, 14 * this.metersPerPixel()), 0, { x: local.x, y: local.y, z: 0 });
			this.edited(polygon, { autosize: before < 3 && polygon.length >= 3 });
			return true;
		}
		return false;
	}

	// ---- sending ----

	send(points) {
		const ms = Date.now();
		const header = { stamp: { sec: Math.floor(ms / 1000), nanosec: (ms % 1000) * 1e6 }, frame_id: this.props.frame || this.ctx.tf.fixed_frame };
		const poses = waypointPoses(points);
		const msg = this.props.message_type === "nav_msgs/msg/Path"
			? { header, poses: poses.map((pose) => ({ header, pose })) }
			: { header, poses };
		this.ctx.publish(this.props.mission_topic, this.props.message_type, msg, { latched: true });
	}

	start() {
		const points = this.result.points;
		if (points.length === 0) {
			this.status.warn(this.result.error ?? "There is no survey path yet: draw at least three vertices.");
			return;
		}
		this.send(points);
		if (this.mode !== "idle")
			this.setMode(this.mode);
		this.setInfo({ ...this.info, "Last sent": `${points.length} waypoints to ${this.props.mission_topic}` });
	}

	stop() {
		this.send([]);
		this.setInfo({ ...this.info, "Last sent": `empty mission (stop) to ${this.props.mission_topic}` });
	}

	// ---- the panel ----

	buildCustomEditor(container) {
		const row = (...children) => {
			const element = document.createElement("div");
			element.className = "waypoint_buttons";
			element.append(...children);
			return element;
		};
		this.editButtons = {
			xy: button("Edit area", "Click the ground to add a vertex (near an edge to insert it), drag a vertex or the ST / FIN markers to move them (Shift snaps to 0.5 m), tap a vertex to delete it.", () => this.setMode("xy")),
			z: button("Edit heights", "Drag a vertex up or down; waypoint heights follow the edges.", () => this.setMode("z")),
		};
		let clearArmed = null;
		const clear = button("Clear", "Remove the polygon and markers (click twice).", () => {
			if (!clearArmed) {
				clear.textContent = "Click again to clear";
				clearArmed = setTimeout(() => { clear.textContent = "Clear"; clearArmed = null; }, 3000);
				return;
			}
			clearTimeout(clearArmed);
			clearArmed = null;
			clear.textContent = "Clear";
			this.setProp("markers", []);
			this.edited([]);
		});
		container.append(
			row(button("▶ Send survey", "Publish the coverage path (latched).", () => this.start()),
				button("■ Stop", "Publish an empty mission.", () => this.stop())),
			row(this.editButtons.xy, this.editButtons.z, clear),
		);
		this.paintEditor();
	}

	paintEditor() {
		if (!this.editButtons)
			return;
		for (const [mode, element] of Object.entries(this.editButtons)) {
			element.classList.toggle("tool_active", this.mode === mode);
			element.setAttribute("aria-pressed", String(this.mode === mode));
		}
	}

	// ---- framework hooks ----

	onPropertyChange(key, value) {
		if (key === "color") {
			this.material.color.set(value);
			this.outline.material.color.set(value);
		}
		if (key === "path_color")
			this.pathLines.material.color.set(value);
		if (key === "frame")
			this.place();
		if (["spacing", "angle", "turnaround", "crosshatch", "direct_transit", "polygon", "markers"].includes(key))
			this.plan();
		this.redraw();
	}

	onTfChange() {
		this.place();
	}

	onFixedFrameChange() {
		this.place();
		this.redraw();
	}

	_setEnabled(enabled) {
		if (!enabled && this.mode !== "idle")
			this.setMode(this.mode);
		super._setEnabled(enabled);
	}

	onDestroy() {
		if (this.mode !== "idle")
			this.ctx.setPointerEditor?.(null);
		this.worker?.terminate();
		for (const child of this.vertices.children)
			child.geometry.dispose();
		this.material.dispose();
		for (const material of this.markerMaterials)
			material.dispose();
	}
}
