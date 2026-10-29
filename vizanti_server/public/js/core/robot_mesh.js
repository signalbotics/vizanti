import * as THREE from '../lib/three.module.min.js';
import { rpyToQuat, meshUrl } from '../geometry/urdf.js';
import { getMeshLoaders } from './mesh_loader.js';

const DEFAULT_COLOR = [0.7, 0.7, 0.7, 1];
const COLLISION_COLOR = [0.9, 0.5, 0.1, 0.45];

// the page's base URL (index.html declares it); empty where there is no page (tests)
const baseUrl = () => (typeof base_url === "undefined" ? "" : base_url);

// The 3D model of a parsed URDF (geometry/urdf.js): one group per link holding its visual and
// collision shapes and meshes. Whoever owns it places the links: the Robot Model display from TF,
// MoveIt's displays from joint values (geometry/kinematics.js). One robot can be drawn several
// times (start state, goal state, trajectory) by making several RobotMesh objects.
//
//   onChange()  called when a mesh finishes loading (or fails), so the owner can redraw and report
export class RobotMesh {

	constructor(robot, { order = 0, onChange = () => {} } = {}) {
		this.robot = robot;
		this.order = order;
		this.onChange = onChange;
		this.group = new THREE.Group();
		this.links = new Map(); // link name -> { group, visual, collision }
		this.pendingMeshes = 0;
		this.failedMeshes = [];
		this.alive = true;
		this.opacity = 1;
		this.color = null; // [r, g, b] over every material, or null for the URDF's own colours

		for (const [name, link] of Object.entries(robot.links)) {
			const entry = { group: new THREE.Group(), visual: new THREE.Group(), collision: new THREE.Group() };
			entry.group.name = name;
			entry.group.userData.selectLabel = `Link: ${name}`;
			entry.group.add(entry.visual, entry.collision);
			for (const part of link.visuals)
				this.addPart(entry.visual, part, part.color ?? DEFAULT_COLOR);
			for (const part of link.collisions)
				this.addPart(entry.collision, part, COLLISION_COLOR);
			this.group.add(entry.group);
			this.links.set(name, entry);
		}
		this.setOrder(order);
	}

	material(color) {
		const [r, g, b, a] = color;
		const material = new THREE.MeshLambertMaterial({ color: new THREE.Color(r, g, b), side: THREE.DoubleSide });
		material.userData.alpha = a;
		material.userData.color = material.color.clone();
		return material;
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
		const source = meshUrl(shape.filename, baseUrl());
		if (!source) {
			this.failedMeshes.push(shape.filename);
			return;
		}
		this.pendingMeshes++;
		try {
			const loaders = await getMeshLoaders();
			const loaded = await loaders[source.format].loadAsync(source.url);
			if (!this.alive)
				return; // disposed while the mesh was loading

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
					material.userData.color ??= material.color?.clone();
					material.side = THREE.DoubleSide;
				}
			});

			const scaled = new THREE.Group();
			scaled.scale.fromArray(shape.scale);
			scaled.add(object);
			holder.add(scaled);
			holder.traverse((child) => { child.renderOrder = this.order; });
			this.applyLook();
		} catch (e) {
			if (this.alive)
				this.failedMeshes.push(shape.filename);
		} finally {
			if (this.alive) {
				this.pendingMeshes--;
				this.onChange();
			}
		}
	}

	setOrder(order) {
		this.order = order;
		this.group.traverse((object) => { object.renderOrder = order; });
	}

	setVisibility(visual, collision) {
		for (const entry of this.links.values()) {
			entry.visual.visible = visual;
			entry.collision.visible = collision;
		}
	}

	setOpacity(opacity) {
		this.opacity = opacity;
		this.applyLook();
	}

	// one colour over the whole robot (a MoveIt start / goal state), or null for its own colours
	setColor(rgb) {
		this.color = rgb;
		this.applyLook();
	}

	applyLook() {
		const override = this.color ? new THREE.Color(...this.color) : null;
		this.group.traverse((object) => {
			if (!object.isMesh)
				return;
			for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
				if (material.color)
					material.color.copy(override ?? material.userData.color ?? material.color);
				const value = (material.userData.alpha ?? 1) * this.opacity;
				material.opacity = value;
				const transparent = value < 1;
				if (material.transparent !== transparent) {
					material.transparent = transparent;
					material.needsUpdate = true;
				}
			}
		});
	}

	// poses: Map link -> { translation: [x, y, z], rotation: { x, y, z, w } }, relative to this.group
	// (geometry/kinematics.js forwardKinematics). Links without a pose are hidden.
	setPoses(poses) {
		for (const [name, entry] of this.links) {
			const pose = poses.get(name);
			entry.group.visible = !!pose;
			if (pose) {
				entry.group.position.fromArray(pose.translation);
				entry.group.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
			}
		}
	}

	dispose() {
		this.alive = false;
		this.group.removeFromParent();
		this.group.traverse((object) => {
			if (object.geometry)
				object.geometry.dispose();
			for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) {
				if (material.map)
					material.map.dispose();
				material.dispose();
			}
		});
		this.links.clear();
	}
}
