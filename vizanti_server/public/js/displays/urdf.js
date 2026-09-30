import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { parseUrdf, rpyToQuat, meshUrl } from '../geometry/urdf.js';
import { getMeshLoaders } from '../core/mesh_loader.js';

const DEFAULT_COLOR = [0.7, 0.7, 0.7, 1];
const COLLISION_COLOR = [0.9, 0.5, 0.1, 0.45];

// The robot built from its URDF: every link's shapes and meshes, placed at the link's TF frame.
export class UrdfDisplay extends Display {

	static type = "urdf";
	static label = "Robot Model (URDF)";
	static icon = "assets/robotmodel.svg";
	static description = "The robot in 3D, built from its URDF on /robot_description and posed by TF";
	static msgTypes = ["std_msgs/msg/String"];

	static properties = {
		topic: {
			type: "topic", label: "Description topic", default: "/robot_description",
			help: "Published by robot_state_publisher. Each link is drawn at its TF frame, so the joints move with TF.",
		},
		show_visual: { type: "bool", label: "Visual", default: true },
		show_collision: { type: "bool", label: "Collision", default: false },
		opacity: { type: "float", label: "Alpha", default: 1.0, min: 0.05, max: 1, step: 0.05, slider: true },
		tf_prefix: { type: "string", label: "TF prefix", default: "" },
		hidden_links: { type: "object", default: {} },
	};

	get iconColor() {
		return null;
	}

	onCreate() {
		this.links = new Map(); // link name -> { group, visual, collision }
		this.robot = null;
		this.loaders = null;
		this.pendingMeshes = 0;
		this.failedMeshes = [];
		this.editor = null;
	}

	// the mesh loaders are only fetched when a robot actually uses meshes
	async getLoaders() {
		return getMeshLoaders();
	}

	material(color) {
		const [r, g, b, a] = color;
		const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide });
		material.userData.alpha = a;
		return material;
	}

	onMessage(msg) {
		const text = typeof msg.data === "string" ? msg.data : "";
		if (this.robot && text === this.lastText)
			return; // the same description again

		let robot;
		try {
			robot = parseUrdf(text);
		} catch (e) {
			this.status.error("The robot description could not be read: " + e.message);
			return;
		}
		this.lastText = text;
		this.clear();
		this.robot = robot;
		this.generation = (this.generation ?? 0) + 1;

		for (const [name, link] of Object.entries(robot.links)) {
			const entry = { group: new THREE.Group(), visual: new THREE.Group(), collision: new THREE.Group() };
			entry.group.name = name;
			entry.group.userData.selectLabel = `Link: ${name}`;
			entry.group.add(entry.visual, entry.collision);
			for (const part of link.visuals)
				this.addPart(entry.visual, part, part.color ?? DEFAULT_COLOR);
			for (const part of link.collisions)
				this.addPart(entry.collision, part, COLLISION_COLOR);
			this.add(entry.group);
			this.links.set(name, entry);
		}

		this.root.traverse((object) => { object.renderOrder = this.order; });
		this.applyVisibility();
		this.applyOpacity();
		this.place();
		this.refreshEditor();
		this.report();
	}

	addPart(parent, part, color) {
		const holder = new THREE.Group();
		holder.position.fromArray(part.origin.xyz);
		const q = rpyToQuat(part.origin.rpy);
		holder.quaternion.set(q.x, q.y, q.z, q.w);
		parent.add(holder);

		const shape = part.geometry;
		if (shape.type === "box") {
			holder.add(new THREE.Mesh(new THREE.BoxGeometry(...shape.size), this.material(color)));
		} else if (shape.type === "cylinder") {
			// URDF cylinders run along z, three.js cylinders along y
			holder.add(new THREE.Mesh(new THREE.CylinderGeometry(shape.radius, shape.radius, shape.length, 32).rotateX(Math.PI / 2), this.material(color)));
		} else if (shape.type === "sphere") {
			holder.add(new THREE.Mesh(new THREE.SphereGeometry(shape.radius, 32, 16), this.material(color)));
		} else if (shape.type === "mesh") {
			this.loadMesh(holder, shape, color, part.color !== null);
		}
	}

	async loadMesh(holder, shape, color, hasUrdfColor) {
		const source = meshUrl(shape.filename, base_url);
		if (!source) {
			this.failedMeshes.push(shape.filename);
			return;
		}
		const generation = this.generation;
		this.pendingMeshes++;
		try {
			const loaders = await this.getLoaders();
			const loaded = await loaders[source.format].loadAsync(source.url);
			if (generation !== this.generation || !this._alive)
				return; // a newer description replaced this one while the mesh was loading

			let object;
			if (source.format === "stl") {
				if (!loaded.attributes.normal)
					loaded.computeVertexNormals();
				object = new THREE.Mesh(loaded, this.material(color));
			} else if (source.format === "dae") {
				object = loaded.scene;
				// the loader turns Z-up files to three.js's Y-up; this scene is Z-up like the file
				object.rotation.set(0, 0, 0);
			} else {
				object = loaded;
			}

			// meshes that bring no materials of their own, or a URDF colour override, use the URDF colour
			object.traverse((child) => {
				if (!child.isMesh)
					return;
				if (source.format === "obj" || (source.format === "dae" && hasUrdfColor))
					child.material = this.material(color);
				const materials = Array.isArray(child.material) ? child.material : [child.material];
				for (const material of materials) {
					material.userData.alpha ??= material.opacity ?? 1;
					material.side = THREE.DoubleSide;
				}
			});

			const scaled = new THREE.Group();
			scaled.scale.fromArray(shape.scale);
			scaled.add(object);
			holder.add(scaled);
			holder.traverse((child) => { child.renderOrder = this.order; });
			this.applyOpacity();
		} catch (e) {
			if (generation === this.generation)
				this.failedMeshes.push(shape.filename);
		} finally {
			if (generation === this.generation) {
				this.pendingMeshes--;
				this.report();
				this.requestRender();
			}
		}
	}

	// moves every link to its TF frame; links with no transform yet are hidden
	place() {
		const tf = this.ctx.tf;
		this.missing = 0;
		for (const [name, entry] of this.links) {
			const frame = this.props.tf_prefix + name;
			let pose = tf.absoluteTransforms[frame];
			if (!pose && frame === tf.fixed_frame)
				pose = { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
			entry.placed = !!pose;
			if (pose) {
				entry.group.position.set(pose.translation.x, pose.translation.y, pose.translation.z);
				entry.group.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
			} else {
				this.missing++;
			}
			entry.group.visible = entry.placed && !this.props.hidden_links[name];
		}
	}

	report() {
		if (!this.robot)
			return;
		const total = this.links.size;
		this.setInfo({
			"Robot": this.robot.name || "(unnamed)",
			"Links": total,
			"Meshes loading": this.pendingMeshes,
		});
		if (this.failedMeshes.length)
			this.status.error(`${this.failedMeshes.length} mesh(es) could not be loaded, first: ${this.failedMeshes[0]}`);
		else if (this.missing === total && total > 0)
			this.status.warn("No TF for any link of this robot yet. Is robot_state_publisher running, and is the TF prefix right?");
		else if (this.missing > 0)
			this.status.warn(`No TF for ${this.missing} of ${total} links.`);
		else if (this.robot.skipped > 0)
			this.status.warn(`${this.robot.skipped} shape(s) in the description could not be read and are not shown.`);
		else
			this.status.ok();
	}

	applyVisibility() {
		for (const entry of this.links.values()) {
			entry.visual.visible = this.props.show_visual;
			entry.collision.visible = this.props.show_collision;
		}
	}

	applyOpacity() {
		const opacity = this.props.opacity;
		this.root.traverse((object) => {
			if (!object.isMesh)
				return;
			for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
				const value = (material.userData.alpha ?? 1) * opacity;
				material.opacity = value;
				const transparent = value < 1;
				if (material.transparent !== transparent) {
					material.transparent = transparent;
					material.needsUpdate = true;
				}
			}
		});
	}

	clear() {
		for (const entry of this.links.values()) {
			entry.group.removeFromParent();
			entry.group.traverse((object) => {
				if (object.geometry)
					object.geometry.dispose();
				for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) {
					if (material.map)
						material.map.dispose();
					material.dispose();
				}
			});
		}
		this.links.clear();
		this.robot = null;
		this.failedMeshes = [];
		this.pendingMeshes = 0;
		this.generation = (this.generation ?? 0) + 1;
	}

	onTfChange() {
		const before = this.missing;
		this.place();
		if (before !== this.missing)
			this.report();
	}

	onFixedFrameChange() {
		this.place();
		this.report();
	}

	onPropertyChange(key) {
		if (key === "topic") {
			this.clear();
			this.lastText = null;
			this.setInfo({});
			this.refreshEditor();
		}
		if (key === "opacity")
			this.applyOpacity();
		if (key === "tf_prefix" || key === "hidden_links") {
			this.place();
			this.report();
		}
		this.applyVisibility();
	}

	onDestroy() {
		this.clear();
	}

	// ---- per-link visibility ----

	refreshEditor() {
		if (!this.editor)
			return;
		if (this.editor.list.isConnected)
			this.editor.render();
		else
			this.editor = null;
	}

	buildCustomEditor(container) {
		const details = document.createElement("details");
		const summary = document.createElement("summary");
		summary.textContent = "Links";
		const list = document.createElement("div");
		details.append(summary, list);
		container.appendChild(details);

		const render = () => {
			list.replaceChildren();
			for (const name of [...this.links.keys()].sort()) {
				const row = document.createElement("div");
				row.classList.add("tf_label");
				const checkbox = document.createElement("input");
				checkbox.type = "checkbox";
				checkbox.checked = !this.props.hidden_links[name];
				checkbox.addEventListener("change", () => {
					const hidden = { ...this.props.hidden_links };
					if (checkbox.checked)
						delete hidden[name];
					else
						hidden[name] = true;
					this.setProp("hidden_links", hidden);
				});
				const label = document.createElement("label");
				label.textContent = " " + name;
				row.append(checkbox, label);
				list.appendChild(row);
			}
		};
		render();
		this.editor = { list, render };
	}
}
