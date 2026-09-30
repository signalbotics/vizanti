import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { buildMarker, disposeMarker, markerKey, markerExpired } from '../geometry/markers.js';
import { loadMeshObject } from '../core/mesh_loader.js';

export class MarkerArrayDisplay extends Display {

	static type = "markerarray";
	static label = "Marker Array";
	static icon = "assets/markerarray.svg";
	static description = "visualization_msgs/MarkerArray";
	static msgTypes = ["visualization_msgs/msg/MarkerArray"];

	static properties = {
		topic: { type: "topic", label: "Topic", help: "All marker types are drawn in 3D. Mesh markers need package:// paths to .stl, .dae or .obj files." },
		opacity: { type: "float", label: "Opacity", default: 1.0, min: 0, max: 1, step: 0.05, slider: true },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 100, min: 0, max: 10000 },
		disabled_namespaces: { type: "object", default: {} },
	};

	// the old widget stored the hidden namespaces as a list
	static fromLegacy(state) {
		const disabled = {};
		for (const ns of Array.isArray(state.disabled_namespaces) ? state.disabled_namespaces : [])
			disabled[ns] = true;
		return { ...state, disabled_namespaces: disabled };
	}

	get iconColor() {
		return null;
	}

	onCreate() {
		this.markers = new Map(); // key -> { outer, built, ns, frame, locked, lifetime, stamp }
		this.editor = null;
		this.timer = setInterval(() => this.applyVisibility(), 500);
	}

	remove(key) {
		const entry = this.markers.get(key);
		if (!entry)
			return;
		entry.outer.removeFromParent();
		disposeMarker(entry.outer);
		if (entry.lineObjects) {
			for (const lines of entry.lineObjects)
				this.ctx.scene.disposeLines(lines);
		}
		this.markers.delete(key);
	}

	clear() {
		for (const key of [...this.markers.keys()])
			this.remove(key);
	}

	// MESH_RESOURCE markers: the mesh arrives after the marker is already placed
	async loadMesh(key, built) {
		const { filename, scale, color, embedded } = built.mesh;
		const makeMaterial = () => {
			const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(color[0], color[1], color[2]), side: THREE.DoubleSide });
			material.userData.alpha = color[3];
			return material;
		};
		try {
			// a colour of all zeros means "use the mesh's own materials"
			const keepOwn = embedded || color.every((v) => v === 0);
			const object = await loadMeshObject(filename, makeMaterial, keepOwn);
			if (!this._alive || this.markers.get(key)?.built !== built) {
				disposeMarker(object);
				return; // the marker was replaced or removed while the mesh loaded
			}
			object.scale.fromArray(scale);
			built.object.add(object);
			built.object.traverse((child) => { child.renderOrder = this.order; });
			this.applyOpacity();
			this.requestRender();
		} catch (e) {
			this.status.warn(`Mesh marker could not be loaded: ${e.message}`);
		}
	}

	placeOuter(entry, transform) {
		entry.outer.position.set(transform.translation.x, transform.translation.y, transform.translation.z);
		entry.outer.quaternion.set(transform.rotation.x, transform.rotation.y, transform.rotation.z, transform.rotation.w);
	}

	onMessage(msg) {
		const tf = this.ctx.tf;
		const scene = this.ctx.scene;
		let problem = null;

		for (const m of msg.markers ?? []) {
			if (m.action === 3) {
				this.clear();
				continue;
			}
			const key = markerKey(m);
			if (m.action === 2) {
				this.remove(key);
				continue;
			}

			let frame = m.header.frame_id;
			if (frame === "") {
				problem = { level: "warn", text: "Transform frame is an empty string, falling back to fixed frame. Fix your publisher ;)" };
				frame = tf.fixed_frame;
			}
			let transform = tf.getAbsoluteTransform({ frame_id: frame, stamp: m.header.stamp });
			if (!transform && frame === tf.fixed_frame)
				transform = { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
			if (!transform) {
				problem = { level: "error", text: `Required transform frame "${frame}" not found.` };
				continue;
			}

			this.remove(key);

			const lineObjects = [];
			const built = buildMarker(m, {
				// line width is scale.x in metres
				makeLines: (positions, colors, marker) => {
					const alpha = Math.min(Math.max(marker.color?.a ?? 1, 0), 1);
					const lines = scene.makeLines({ linewidth: marker.scale.x, opacity: alpha, vertexColors: true, worldUnits: true });
					lines.material.userData.alpha = alpha;
					scene.setLinePositions(lines, positions, colors);
					lineObjects.push(lines);
					return lines;
				},
			});
			if (built.warning)
				problem = { level: "warn", text: built.warning };
			if (built.mesh)
				this.loadMesh(key, built);

			const entry = {
				outer: new THREE.Group(),
				built,
				lineObjects,
				ns: m.ns ?? "",
				frame,
				locked: !!m.frame_locked,
				lifetime: m.lifetime,
				stamp: Date.now(),
			};
			entry.outer.add(built.object);
			entry.outer.userData.selectLabel = `Marker: ${m.ns ?? ""} #${m.id ?? 0}`;
			this.placeOuter(entry, transform);
			this.add(entry.outer);
			entry.outer.traverse((object) => { object.renderOrder = this.order; });
			this.markers.set(key, entry);
		}

		this.applyOpacity();
		this.applyPointSizes();
		this.applyVisibility();
		this.refreshEditor();
		this.setInfo({ "Markers": this.markers.size });
		if (problem)
			this.status[problem.level](problem.text);
	}

	applyVisibility() {
		const now = Date.now();
		let changed = false;
		for (const [key, entry] of this.markers) {
			if (markerExpired(entry.lifetime, entry.stamp, now)) {
				this.remove(key);
				changed = true;
				continue;
			}
			const visible = this.props.opacity > 0 && !this.props.disabled_namespaces[entry.ns];
			if (entry.outer.visible !== visible) {
				entry.outer.visible = visible;
				changed = true;
			}
		}
		if (changed)
			this.requestRender();
	}

	applyOpacity() {
		const opacity = this.props.opacity;
		for (const entry of this.markers.values()) {
			entry.outer.traverse((object) => {
				const material = object.material;
				if (!material || material.userData.alpha === undefined)
					return;
				material.opacity = material.userData.alpha * opacity;
				const transparent = material.opacity < 1;
				if (material.transparent !== transparent) {
					material.transparent = transparent;
					material.needsUpdate = true;
				}
			});
		}
	}

	applyPointSizes() {
		for (const entry of this.markers.values()) {
			entry.outer.traverse((object) => {
				if (!object.isPoints)
					return;
				const size = this.ctx.scene.pointSize(object.userData.pointMeters);
				object.material.size = size.size;
				if (object.material.sizeAttenuation !== size.sizeAttenuation) {
					object.material.sizeAttenuation = size.sizeAttenuation;
					object.material.needsUpdate = true;
				}
			});
		}
	}

	_setEnabled(enabled) {
		super._setEnabled(enabled);
		if (!enabled)
			this.clear();
	}

	// frame-locked markers follow their frame; the rest stay where they were published
	onTfChange() {
		const tf = this.ctx.tf;
		for (const entry of this.markers.values()) {
			if (entry.locked && tf.absoluteTransforms[entry.frame])
				this.placeOuter(entry, tf.absoluteTransforms[entry.frame]);
		}
	}

	onFixedFrameChange() {
		const tf = this.ctx.tf;
		for (const entry of this.markers.values()) {
			if (tf.absoluteTransforms[entry.frame])
				this.placeOuter(entry, tf.absoluteTransforms[entry.frame]);
		}
	}

	onCameraChange() {
		this.applyPointSizes();
	}

	// text markers always face the viewer, so they are drawn on the 2D overlay
	onOverlay(ctx, scene) {
		if (this.props.opacity <= 0)
			return;
		const position = new THREE.Vector3();
		const ppm = scene.pixelsPerMeter();
		ctx.globalAlpha = this.props.opacity;
		ctx.textAlign = "center";
		ctx.lineJoin = "round";
		ctx.miterLimit = 2;

		for (const entry of this.markers.values()) {
			const text = entry.built.text;
			if (!text || !entry.outer.visible)
				continue;
			entry.built.object.getWorldPosition(position);
			const point = scene.project(position.x, position.y, position.z);
			if (!point.visible)
				continue;

			const size = Math.max(6, text.height * ppm);
			const lineHeight = size * 1.2;
			ctx.font = `${size}px Monospace`;
			ctx.fillStyle = text.color;
			ctx.strokeStyle = text.outline;
			ctx.lineWidth = size * 0.25;
			const top = point.y - ((text.lines.length - 1) * lineHeight) / 2 + size * 0.35;
			text.lines.forEach((line, i) => {
				ctx.strokeText(line, point.x, top + i * lineHeight);
				ctx.fillText(line, point.x, top + i * lineHeight);
			});
		}
		ctx.globalAlpha = 1;
	}

	onPropertyChange(key) {
		if (key === "opacity")
			this.applyOpacity();
		if (key === "topic") {
			this.clear();
			this.setInfo({});
		}
		this.applyVisibility();
	}

	onDestroy() {
		clearInterval(this.timer);
		this.clear();
	}

	// ---- namespace list ----

	namespaces() {
		return [...new Set([...this.markers.values()].map((entry) => entry.ns))].sort();
	}

	refreshEditor() {
		if (!this.editor)
			return;
		if (!this.editor.list.isConnected) {
			this.editor = null;
			return;
		}
		const key = this.namespaces().join("\u0000");
		if (key !== this.editor.key) {
			this.editor.key = key;
			this.editor.render();
		}
	}

	buildCustomEditor(container) {
		const heading = document.createElement("label");
		heading.textContent = "Namespaces:";
		const list = document.createElement("div");
		container.append(heading, list);

		const render = () => {
			list.replaceChildren();
			for (const ns of this.namespaces()) {
				const row = document.createElement("div");
				row.classList.add("tf_label", "param_toggle_label");
				const checkbox = document.createElement("input");
				checkbox.type = "checkbox";
				checkbox.checked = !this.props.disabled_namespaces[ns];
				checkbox.addEventListener("change", () => {
					const disabled = { ...this.props.disabled_namespaces };
					if (checkbox.checked)
						delete disabled[ns];
					else
						disabled[ns] = true;
					this.setProp("disabled_namespaces", disabled);
				});
				const label = document.createElement("label");
				label.textContent = " " + (ns === "" ? "No namespace" : ns);
				row.append(checkbox, label);
				list.appendChild(row);
			}
		};

		render();
		this.editor = { list, render, key: this.namespaces().join("\u0000") };
	}
}
