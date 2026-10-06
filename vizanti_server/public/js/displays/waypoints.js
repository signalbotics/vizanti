import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { insertIndex, closestIndex, waypointPoses, parseWaypointCsv, marginSegments, fromLegacyWaypoints } from '../geometry/waypoints.js';

const HIT_PX = 14; // how close (screen pixels) a press must be to grab a point

const button = (text, title, onClick) => {
	const element = document.createElement("button");
	element.type = "button";
	element.textContent = text;
	element.title = title;
	element.addEventListener("click", onClick);
	return element;
};

// A waypoint mission edited in the 3D view and sent as nav_msgs/Path or geometry_msgs/PoseArray.
// Replaces the old 2D "waypoints" widget and carries over its saved missions.
export class WaypointsDisplay extends Display {

	static type = "waypoints";
	static label = "Waypoints";
	static icon = "assets/waypoints.svg";
	static description = "Edit a waypoint mission in the view and send it as a Path or PoseArray";

	static properties = {
		mission_topic: { type: "string", label: "Topic", default: "/waypoints", help: "Where the mission is published (latched)." },
		message_type: {
			type: "enum", label: "Message type", default: "nav_msgs/msg/Path",
			options: [
				{ value: "nav_msgs/msg/Path", label: "nav_msgs/Path" },
				{ value: "geometry_msgs/msg/PoseArray", label: "geometry_msgs/PoseArray" },
			],
		},
		frame: { type: "frame", label: "Mission frame", help: "The waypoints are kept and sent in this frame (the fixed frame when empty)." },
		robot_frame: { type: "frame", label: "Robot frame", default: "base_link", noDefault: true, help: 'Used by "Start from the closest waypoint".' },
		start_closest: { type: "bool", label: "Start from the closest waypoint", default: false },
		margin: { type: "float", label: "Safety margin (m)", default: 0.8, min: 0, max: 50, step: 0.1, help: "Drawn on both sides of the path; 0 hides it." },
		color: { type: "color", label: "Colour", default: "#ffd23f" },
		points: { type: "array" },
	};

	static migrateProps(props) {
		return props.state && typeof props.state === "object" ? fromLegacyWaypoints(props.state) : props;
	}

	static fromLegacy(state) {
		return fromLegacyWaypoints(state);
	}

	onCreate() {
		const scene = this.ctx.scene;
		this.mode = "idle"; // "idle" | "xy" | "z"
		this.drag = null;   // { index, startY, startZ, moved }
		this.material = new THREE.MeshLambertMaterial({ color: this.props.color });
		this.markers = new THREE.Group();
		this.path = scene.makeLines({ color: this.props.color, linewidth: 3 });
		this.marginLines = scene.makeLines({ color: this.props.color, linewidth: 1, opacity: 0.45 });
		this.add(this.markers);
		this.add(this.path);
		this.add(this.marginLines);
		this.place();
		this.rebuild();
		this.status.ok();
	}

	place() {
		const node = this.ctx.frames.get(this.props.frame);
		if (!node) {
			this.status.warn(`Transform to frame '${this.props.frame}' not yet available.`);
			return false;
		}
		if (this.root.parent !== node)
			node.add(this.root);
		return true;
	}

	points() {
		return Array.isArray(this.props.points) ? this.props.points : [];
	}

	setPoints(points) {
		this.setProp("points", points.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 })));
		this.rebuild();
		this.paintEditor();
	}

	// ---- drawing ----

	rebuild() {
		const scene = this.ctx.scene;
		const points = this.points();
		for (const child of [...this.markers.children]) {
			child.geometry.dispose();
			this.markers.remove(child);
		}
		const radius = 0.12;
		const sphere = new THREE.SphereGeometry(radius, 16, 12);
		points.forEach((p, i) => {
			const mesh = new THREE.Mesh(i === 0 ? sphere : sphere.clone(), this.material);
			mesh.position.set(p.x, p.y, p.z);
			mesh.renderOrder = this.order;
			this.markers.add(mesh);
		});
		const line = [];
		for (let i = 0; i + 1 < points.length; i++)
			line.push(points[i].x, points[i].y, points[i].z, points[i + 1].x, points[i + 1].y, points[i + 1].z);
		scene.setLinePositions(this.path, line);
		const margin = marginSegments(points, this.props.margin).flatMap(([a, b]) => [a.x, a.y, a.z, b.x, b.y, b.z]);
		scene.setLinePositions(this.marginLines, margin);
		this.setInfo({ "Waypoints": points.length, "Editing": this.mode === "idle" ? "no" : (this.mode === "xy" ? "positions" : "heights") });
		this.requestRender();
	}

	// numbers next to the waypoints, and a hint while editing
	onOverlay(ctx, scene) {
		const points = this.points();
		ctx.font = "bold 12px system-ui, sans-serif";
		ctx.textAlign = "left";
		ctx.lineWidth = 3;
		ctx.strokeStyle = "#161B21";
		ctx.fillStyle = "#ffffff";
		const world = new THREE.Vector3();
		points.forEach((p, i) => {
			world.set(p.x, p.y, p.z);
			this.root.localToWorld(world);
			const s = scene.project(world.x, world.y, world.z);
			if (!s.visible)
				return;
			const label = this.mode === "z" ? `${i + 1}  z=${p.z.toFixed(2)}` : String(i + 1);
			ctx.strokeText(label, s.x + 9, s.y - 9);
			ctx.fillText(label, s.x + 9, s.y - 9);
		});
	}

	// ---- editing in the view ----

	setMode(mode) {
		this.mode = this.mode === mode ? "idle" : mode;
		this.drag = null;
		this.ctx.setPointerEditor?.(this.mode === "idle" ? null : this);
		this.rebuild();
		this.paintEditor();
	}

	// the screen position of point i, in canvas pixels
	screenOf(p) {
		const world = new THREE.Vector3(p.x, p.y, p.z);
		this.root.localToWorld(world);
		return this.ctx.scene.project(world.x, world.y, world.z);
	}

	hitPoint(event) {
		const rect = this.ctx.scene.canvas.getBoundingClientRect();
		const x = event.clientX - rect.left, y = event.clientY - rect.top;
		let best = -1, bestDistance = HIT_PX;
		this.points().forEach((p, i) => {
			const s = this.screenOf(p);
			const d = Math.hypot(s.x - x, s.y - y);
			if (s.visible && d <= bestDistance) {
				best = i;
				bestDistance = d;
			}
		});
		return best;
	}

	// a ground point (fixed frame) in the mission frame
	toLocal(ground) {
		const v = new THREE.Vector3(ground.x, ground.y, ground.z);
		this.root.updateWorldMatrix(true, false);
		return this.root.worldToLocal(v);
	}

	onEditPointer(kind, { event, ground }) {
		const points = this.points();
		if (kind === "down") {
			const index = this.hitPoint(event);
			if (index === -1)
				return false; // not on a point: the camera moves, or a click adds one
			this.drag = { index, startX: event.clientX, startY: event.clientY, startZ: points[index].z, moved: false };
			return true;
		}
		if (kind === "move" && this.drag) {
			const next = points.map((p) => ({ ...p }));
			const p = next[this.drag.index];
			if (this.mode === "z") {
				const metersPerPixel = 1 / Math.max(1e-6, this.ctx.scene.pixelsPerMeter());
				p.z = this.drag.startZ + (this.drag.startY - event.clientY) * metersPerPixel;
			} else if (ground) {
				const local = this.toLocal(ground);
				p.x = local.x;
				p.y = local.y;
				if (event.shiftKey) {
					p.x = Math.round(p.x * 2) / 2; // snap to half metres
					p.y = Math.round(p.y * 2) / 2;
				}
			}
			this.drag.moved = this.drag.moved || Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) > 3;
			this.props.points = next; // live, saved on release
			this.rebuild();
			return true;
		}
		if (kind === "up" && this.drag) {
			const { index, moved } = this.drag;
			this.drag = null;
			const current = this.points();
			if (!moved && this.mode === "xy")
				current.splice(index, 1); // a tap on a point deletes it
			this.setPoints(current);
			return true;
		}
		if (kind === "click" && this.mode === "xy" && ground) {
			const local = this.toLocal(ground);
			const p = { x: local.x, y: local.y, z: 0 };
			const tolerance = HIT_PX / Math.max(1e-6, this.ctx.scene.pixelsPerMeter());
			const next = points.map((q) => ({ ...q }));
			next.splice(insertIndex(next, p, tolerance), 0, p);
			this.setPoints(next);
			return true;
		}
		return false;
	}

	// ---- sending ----

	missionFrame() {
		return this.props.frame || this.ctx.tf.fixed_frame;
	}

	send(points) {
		const stamp = (() => {
			const ms = Date.now();
			return { sec: Math.floor(ms / 1000), nanosec: (ms % 1000) * 1e6 };
		})();
		const header = { stamp, frame_id: this.missionFrame() };
		const poses = waypointPoses(points);
		const msg = this.props.message_type === "nav_msgs/msg/Path"
			? { header, poses: poses.map((pose) => ({ header, pose })) }
			: { header, poses };
		this.ctx.publish(this.props.mission_topic, this.props.message_type, msg, { latched: true });
	}

	start() {
		let points = this.points();
		if (points.length === 0) {
			this.status.warn("There are no waypoints to send.");
			return;
		}
		if (this.props.start_closest) {
			const robot = this.ctx.tf.absoluteTransforms[this.props.robot_frame];
			if (!robot) {
				this.status.error(`Robot frame "${this.props.robot_frame}" not found; cannot start from the closest waypoint.`);
				return;
			}
			const local = this.toLocal(robot.translation);
			points = points.slice(closestIndex(points, local));
		}
		this.send(points);
		if (this.mode !== "idle")
			this.setMode(this.mode); // sending ends editing
		this.status.ok();
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
			xy: button("Edit positions", "Click the ground to add a waypoint (near the path to insert it), drag one to move it (Shift snaps to 0.5 m), tap one to delete it.", () => this.setMode("xy")),
			z: button("Edit heights", "Drag a waypoint up or down to change its height.", () => this.setMode("z")),
		};
		const zInput = document.createElement("input");
		zInput.type = "number";
		zInput.step = "0.1";
		zInput.value = "0";
		zInput.className = "waypoint_z";
		zInput.setAttribute("aria-label", "Height for every waypoint (m)");
		const csv = document.createElement("input");
		csv.type = "file";
		csv.accept = ".csv,.txt";
		csv.hidden = true;
		csv.addEventListener("change", async () => {
			const file = csv.files[0];
			csv.value = "";
			if (!file)
				return;
			const points = parseWaypointCsv(await file.text());
			if (points.length === 0) {
				this.status.warn(`"${file.name}" has no x,y rows.`);
				return;
			}
			this.setPoints(points);
		});
		let clearArmed = null;
		const clear = button("Clear", "Remove every waypoint (click twice).", () => {
			if (!clearArmed) {
				clear.textContent = "Click again to clear";
				clearArmed = setTimeout(() => { clear.textContent = "Clear"; clearArmed = null; }, 3000);
				return;
			}
			clearTimeout(clearArmed);
			clearArmed = null;
			clear.textContent = "Clear";
			this.setPoints([]);
		});
		this.countLabel = document.createElement("span");
		this.countLabel.className = "waypoint_count";
		container.append(
			row(button("▶ Send mission", "Publish the waypoints (latched).", () => this.start()),
				button("■ Stop", "Publish an empty mission.", () => this.stop())),
			row(this.editButtons.xy, this.editButtons.z),
			row(button("Flip order", "Reverse the order of the waypoints.", () => this.setPoints([...this.points()].reverse())),
				zInput, button("Set all heights", "Give every waypoint the height in the box.", () => {
					const z = Number(zInput.value);
					if (Number.isFinite(z))
						this.setPoints(this.points().map((p) => ({ ...p, z })));
				})),
			row(button("Import CSV…", "x,y[,z] per line, in the mission frame (e.g. a path recorded by the Pose Tracker).", () => csv.click()), csv, clear, this.countLabel),
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
		if (this.countLabel)
			this.countLabel.textContent = `${this.points().length} waypoints`;
	}

	// ---- framework hooks ----

	onPropertyChange(key, value) {
		if (key === "color") {
			this.material.color.set(value);
			this.path.material.color.set(value);
			this.marginLines.material.color.set(value);
		}
		if (key === "frame")
			this.place();
		this.rebuild();
		this.paintEditor();
	}

	onTfChange() {
		this.place(); // attaches to the mission frame once it shows up in TF
	}

	onFixedFrameChange() {
		this.place();
		this.rebuild();
	}

	_setEnabled(enabled) {
		if (!enabled && this.mode !== "idle")
			this.setMode(this.mode);
		super._setEnabled(enabled);
	}

	onDestroy() {
		if (this.mode !== "idle")
			this.ctx.setPointerEditor?.(null);
		for (const child of this.markers.children)
			child.geometry.dispose();
		this.material.dispose();
	}
}
