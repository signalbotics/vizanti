// The PlanningScene display (moveit_rviz_plugin/PlanningScene) for Vizanti: MoveIt's world (the
// collision objects and their colours) and the scene's robot with the objects attached to it,
// from moveit_msgs/PlanningScene on /monitored_planning_scene, as in RViz.
import * as THREE from '@vizanti/lib/three.module.min.js';
import { Display } from '@vizanti/plugin_api.js';
import { forwardKinematics, compose } from '@vizanti/geometry/kinematics.js';
import { MoveItRobot } from '../moveit_robot.js';
import { emptyScene, applyPlanningScene, primitiveShape } from '../planning_scene_logic.js';

const rvizColor = (value) => {
	const parts = String(value ?? "").split(";").map((s) => Number(s.trim()));
	return parts.length === 3 && parts.every(Number.isFinite) ? "#" + parts.map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("") : null;
};
const toPose = (p) => ({
	translation: [p?.position?.x ?? 0, p?.position?.y ?? 0, p?.position?.z ?? 0],
	rotation: { x: p?.orientation?.x ?? 0, y: p?.orientation?.y ?? 0, z: p?.orientation?.z ?? 0, w: p?.orientation?.w ?? 1 },
});
const tfPose = (t) => ({ translation: [t.translation.x, t.translation.y, t.translation.z], rotation: t.rotation });
const place = (object, pose) => {
	object.position.fromArray(pose.translation);
	object.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
};

// one shape of a collision object as a three.js mesh (null when it cannot be drawn)
function shapeMesh(entry, material) {
	if (entry.kind === "primitive") {
		const s = primitiveShape(entry.shape);
		if (!s)
			return null;
		let geometry;
		if (s.type === "box")
			geometry = new THREE.BoxGeometry(...s.size);
		else if (s.type === "sphere")
			geometry = new THREE.SphereGeometry(s.radius, 32, 16);
		else // cylinders and cones run along z in ROS, along y in three.js
			geometry = (s.type === "cylinder" ? new THREE.CylinderGeometry(s.radius, s.radius, s.height, 32) : new THREE.ConeGeometry(s.radius, s.height, 32)).rotateX(Math.PI / 2);
		return new THREE.Mesh(geometry, material);
	}
	if (entry.kind === "mesh") {
		const vertices = entry.shape?.vertices ?? [], triangles = entry.shape?.triangles ?? [];
		if (!vertices.length || !triangles.length)
			return null;
		const positions = new Float32Array(triangles.length * 9);
		triangles.forEach((t, i) => (t.vertex_indices ?? []).forEach((v, k) => {
			const p = vertices[v] ?? { x: 0, y: 0, z: 0 };
			positions.set([p.x, p.y, p.z], i * 9 + k * 3);
		}));
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		geometry.computeVertexNormals();
		return new THREE.Mesh(geometry, material);
	}
	if (entry.kind === "plane") { // ax + by + cz + d = 0, drawn as a 2 m square, as RViz draws it
		const [a, b, c, d] = entry.shape?.coef ?? [0, 0, 1, 0];
		const normal = new THREE.Vector3(a, b, c);
		const length = normal.length() || 1;
		normal.divideScalar(length);
		const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
		mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
		mesh.position.copy(normal.clone().multiplyScalar(-d / length));
		return mesh;
	}
	return null;
}

export class PlanningSceneDisplay extends Display {

	static msgTypes = ["moveit_msgs/msg/PlanningScene"];

	static properties = {
		move_group_ns: { type: "string", label: "Move Group Namespace", default: "", help: "The name of the ROS namespace in which the move_group node is running" },
		description: { type: "string", label: "Robot Description", default: "/robot_description", help: "The topic with the robot's URDF (std_msgs/String)." },
		topic: { type: "topic", label: "Planning Scene Topic", default: "/monitored_planning_scene" },
		show_scene: { type: "bool", label: "Show Scene Geometry", default: true, help: "Indicates whether planning scenes should be displayed" },
		scene_alpha: { type: "float", label: "Scene Alpha", default: 0.9, min: 0, max: 1, step: 0.05, slider: true, help: "Specifies the alpha for the scene geometry" },
		scene_color: { type: "color", label: "Scene Color", default: "#32e632", help: "The color for the planning scene obstacles (if a color is not defined)" },
		show_robot: { type: "bool", label: "Show Robot Visual", default: true, help: "Indicates whether the robot state specified by the planning scene should be displayed as defined for visualisation purposes." },
		show_robot_collision: { type: "bool", label: "Show Robot Collision", default: false, help: "Indicates whether the robot state specified by the planning scene should be displayed as defined for collision detection purposes." },
		robot_alpha: { type: "float", label: "Robot Alpha", default: 1, min: 0, max: 1, step: 0.05, slider: true, help: "Specifies the alpha for the robot links" },
		attached_color: { type: "color", label: "Attached Body Color", default: "#963296", help: "The color for the attached bodies" },
	};

	static fromRviz(entry) {
		const props = {};
		const topic = entry?.["Planning Scene Topic"]?.Value ?? entry?.["Planning Scene Topic"];
		if (typeof topic === "string" && topic)
			props.topic = topic.startsWith("/") ? topic : `/${topic}`;
		if (typeof entry?.["Move Group Namespace"] === "string")
			props.move_group_ns = entry["Move Group Namespace"];
		const geometry = entry?.["Scene Geometry"] ?? {}, robot = entry?.["Scene Robot"] ?? {};
		const bool = (key, from, name) => { if (typeof from[name] === "boolean") props[key] = from[name]; };
		const num = (key, from, name) => { if (from[name] !== undefined && Number.isFinite(Number(from[name]))) props[key] = Number(from[name]); };
		bool("show_scene", geometry, "Show Scene Geometry");
		num("scene_alpha", geometry, "Scene Alpha");
		bool("show_robot", robot, "Show Robot Visual");
		bool("show_robot_collision", robot, "Show Robot Collision");
		num("robot_alpha", robot, "Robot Alpha");
		const sceneColor = rvizColor(geometry["Scene Color"]), attachedColor = rvizColor(robot["Attached Body Color"]);
		if (sceneColor)
			props.scene_color = sceneColor;
		if (attachedColor)
			props.attached_color = attachedColor;
		return props;
	}

	onCreate() {
		this.scene = emptyScene();
		this.received = false;
		this.world = new THREE.Group(); // collision objects, placed in the fixed frame
		this.attachedGroup = new THREE.Group();
		this.add(this.world);
		this.add(this.attachedGroup);
		this.robotMesh = null;
		this.model = new MoveItRobot(this, () => {
			this.model.drop(this.robotMesh);
			this.robotMesh = this.model.mesh();
			this.applyRobotLook();
			this.redraw();
			this.fetchScene();
		});
		this.model.listen(this.props.description);
		this.status.warn("No planning scene received");
	}

	// The scene topic only carries changes, so the whole scene is asked for first, as RViz's
	// planning scene monitor does (get_planning_scene, every component).
	async fetchScene() {
		const ns = this.props.move_group_ns.replace(/\/+$/, "");
		const service = `${ns.startsWith("/") || ns === "" ? ns : `/${ns}`}/get_planning_scene`;
		try {
			const response = await this.ctx.callService(service, "moveit_msgs/srv/GetPlanningScene", { components: { components: 1023 } }, 5000);
			this.scene = applyPlanningScene(this.model.robot, emptyScene(), { ...response.scene, is_diff: false });
			this.received = true;
			this.rebuildObjects();
			this.redraw();
		} catch (e) {
			// no move_group (yet): the scene topic still brings changes
		}
	}

	onMessage(msg) {
		this.scene = applyPlanningScene(this.model.robot, this.scene, msg);
		this.received = true;
		this.rebuildObjects();
		this.redraw();
	}

	material(rgb, alpha) {
		return new THREE.MeshLambertMaterial({ color: new THREE.Color(...rgb), transparent: alpha < 1, opacity: alpha, side: THREE.DoubleSide, depthWrite: alpha >= 1 });
	}

	// rebuilds the meshes of every object (world and attached) from this.scene
	rebuildObjects() {
		for (const group of [this.world, this.attachedGroup]) {
			for (const child of [...group.children]) {
				child.removeFromParent();
				child.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
			}
		}
		const sceneRgb = new THREE.Color(this.props.scene_color).toArray();
		const attachedRgb = new THREE.Color(this.props.attached_color).toArray();
		const build = (object, rgb, alpha) => {
			const holder = new THREE.Group();
			holder.name = object.id;
			holder.userData = { frame: object.frame, pose: toPose(object.pose), link: object.link ?? null, selectLabel: `Collision object: ${object.id}` };
			for (const entry of object.shapes) {
				const mesh = shapeMesh(entry, this.material(rgb, alpha));
				if (!mesh)
					continue;
				const at = new THREE.Group();
				place(at, toPose(entry.pose));
				at.add(mesh);
				holder.add(at);
			}
			holder.traverse((o) => { o.renderOrder = this.order; });
			return holder;
		};
		for (const object of this.scene.objects.values()) {
			const color = this.scene.colors.get(object.id);
			this.world.add(build(object, color ? color.slice(0, 3) : sceneRgb, color ? color[3] : this.props.scene_alpha));
		}
		for (const object of this.scene.attached.values())
			this.attachedGroup.add(build(object, attachedRgb, this.props.robot_alpha));
	}

	// places everything: objects at their frames (TF), the robot and attached objects by the scene's state
	redraw() {
		const tf = this.ctx.tf;
		const frameMissing = new Set();
		const framePose = (frame) => {
			if (frame === tf.fixed_frame || frame === "")
				return { translation: [0, 0, 0], rotation: { x: 0, y: 0, z: 0, w: 1 } };
			const t = tf.absoluteTransforms[frame];
			if (!t)
				frameMissing.add(frame);
			return t ? tfPose(t) : null;
		};
		this.world.visible = this.props.show_scene;
		for (const holder of this.world.children) {
			const base = framePose(holder.userData.frame);
			holder.visible = !!base;
			if (base)
				place(holder, compose(base, holder.userData.pose));
		}

		if (this.robotMesh) {
			const placed = this.model.pose(this.robotMesh, this.scene.positions);
			this.robotMesh.group.visible = placed && (this.props.show_robot || this.props.show_robot_collision);
		}
		// attached objects: relative to their link, which moves with the scene robot
		const links = this.model.robot ? forwardKinematics(this.model.robot, this.scene.positions) : new Map();
		const root = this.model.robot?.root ? framePose(this.model.robot.root) : null;
		for (const holder of this.attachedGroup.children) {
			const { frame, pose, link } = holder.userData;
			const onLink = links.get(frame) ?? (frame === "" ? links.get(link) : null);
			const base = onLink && root ? compose(root, onLink) : framePose(frame);
			holder.visible = !!base && this.props.show_robot;
			if (base)
				place(holder, compose(base, pose));
		}
		this.report(frameMissing);
		this.requestRender();
	}

	report(frameMissing) {
		this.setInfo({ "Scene": this.scene.name || "(unnamed)", "Collision objects": this.scene.objects.size, "Attached objects": this.scene.attached.size });
		if (!this.received)
			this.status.warn("No planning scene received");
		else if (frameMissing.size)
			this.status.warn(`No transform to the fixed frame from: ${[...frameMissing].join(", ")}`);
		else
			this.status.ok();
	}

	applyRobotLook() {
		if (!this.robotMesh)
			return;
		this.robotMesh.setVisibility(this.props.show_robot, this.props.show_robot_collision);
		this.robotMesh.setOpacity(this.props.robot_alpha);
	}

	onTfChange() {
		this.redraw();
	}

	onFixedFrameChange() {
		this.redraw();
	}

	onPropertyChange(key) {
		if (key === "description") {
			this.model.listen(this.props.description);
			return;
		}
		if (key === "topic" || key === "move_group_ns") {
			this.scene = emptyScene();
			this.received = false;
			this.fetchScene();
		}
		if (["topic", "scene_alpha", "scene_color", "attached_color", "robot_alpha"].includes(key))
			this.rebuildObjects();
		this.applyRobotLook();
		this.redraw();
	}

	onDestroy() {
		this.model.dispose();
		for (const group of [this.world, this.attachedGroup])
			group.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
	}
}
