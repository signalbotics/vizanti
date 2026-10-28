// The ParticleCloud display (nav2_rviz_plugins/ParticleCloud) for Vizanti: AMCL's particles as
// flat arrows, 3D arrows or axes, each as long as its weight says, as in RViz.
import * as THREE from '@vizanti/lib/three.module.min.js';
import { Display } from '@vizanti/plugin_api.js';
import { SHAPES, SHAFT_RADIUS, HEAD_LENGTH, HEAD_RADIUS, particlePoses, flatArrowVertices, particleCloudFromRviz } from '../particle_cloud_logic.js';

const AXIS_COLORS = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

export class ParticleCloudDisplay extends Display {

	static msgTypes = ["nav2_msgs/msg/ParticleCloud"];

	static properties = {
		topic: { type: "topic", label: "Topic" },
		shape: { type: "enum", label: "Shape", default: "Arrow (Flat)", options: SHAPES.map((value) => ({ value, label: value })), help: "Shape to display the pose as." },
		color: { type: "color", label: "Color", default: "#ff1900", help: "Color to draw the arrows." },
		alpha: { type: "float", label: "Alpha", default: 1, min: 0, max: 1, step: 0.01, slider: true, help: "Amount of transparency to apply to the displayed poses." },
		min_length: { type: "float", label: "Min Arrow Length", default: 0.02, min: 0, max: 10, step: 0.01, help: "Minimum length of the arrows." },
		max_length: { type: "float", label: "Max Arrow Length", default: 0.3, min: 0, max: 10, step: 0.01, help: "Maximum length of the arrows." },
	};

	static fromRviz(entry) {
		return particleCloudFromRviz(entry);
	}

	onCreate() {
		this.poses = [];
		this.message = null;

		this.lineMaterial = new THREE.LineBasicMaterial({ transparent: true, depthWrite: false });
		this.flat = new THREE.LineSegments(new THREE.BufferGeometry(), this.lineMaterial);
		this.axesMaterial = new THREE.LineBasicMaterial({ vertexColors: true });
		this.axes = new THREE.LineSegments(new THREE.BufferGeometry(), this.axesMaterial);
		// a unit 3D arrow along +x (rviz_rendering::Arrow): shaft, then the head
		this.meshMaterial = new THREE.MeshLambertMaterial({ transparent: true });
		this.shaftGeometry = new THREE.CylinderGeometry(SHAFT_RADIUS / 2, SHAFT_RADIUS / 2, 1, 8).rotateZ(-Math.PI / 2).translate(0.5, 0, 0);
		this.headGeometry = new THREE.ConeGeometry(HEAD_RADIUS / 2, HEAD_LENGTH, 12).rotateZ(-Math.PI / 2).translate(1 + HEAD_LENGTH / 2, 0, 0);
		this.shafts = null;
		this.heads = null;
		for (const object of [this.flat, this.axes]) {
			object.frustumCulled = false;
			this.add(object);
		}
		this.applyColor();
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header, { follow: true }))
			return;
		this.message = msg;
		this.rebuild();
	}

	rebuild() {
		if (!this.message)
			return;
		const poses = particlePoses(this.message, this.props.min_length, this.props.max_length);
		if (!poses) {
			this.status.error("Message contained invalid floating point values (nans or infs)");
			return;
		}
		this.poses = poses;
		const shape = this.props.shape;
		this.flat.visible = shape === "Arrow (Flat)";
		this.axes.visible = shape === "Axes";
		if (this.flat.visible)
			this.setLines(this.flat, flatArrowVertices(poses));
		if (this.axes.visible)
			this.buildAxes(poses);
		this.buildArrows3d(shape === "Arrow (3D)" ? poses : []);
		this.setInfo({ "Frame": this.message.header.frame_id, "Particles": poses.length });
		this.requestRender();
	}

	setLines(object, positions, colors = null) {
		object.geometry.dispose();
		object.geometry = new THREE.BufferGeometry();
		object.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		if (colors)
			object.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	}

	// three axes per particle, x red, y green, z blue, as long as the particle's arrow
	buildAxes(poses) {
		const positions = new Float32Array(poses.length * 18);
		const colors = new Float32Array(poses.length * 18);
		const q = new THREE.Quaternion(), v = new THREE.Vector3();
		let i = 0;
		for (const { position: p, orientation: o, length } of poses) {
			q.set(o.x, o.y, o.z, o.w);
			for (let axis = 0; axis < 3; axis++) {
				v.set(axis === 0 ? length : 0, axis === 1 ? length : 0, axis === 2 ? length : 0).applyQuaternion(q);
				positions.set([p.x, p.y, p.z, p.x + v.x, p.y + v.y, p.z + v.z], i);
				colors.set([...AXIS_COLORS[axis], ...AXIS_COLORS[axis]], i);
				i += 6;
			}
		}
		this.setLines(this.axes, positions, colors);
	}

	// one instanced shaft and head per particle, scaled by its length
	buildArrows3d(poses) {
		if (!this.shafts || this.shafts.count < poses.length || poses.length === 0) {
			for (const mesh of [this.shafts, this.heads]) {
				if (mesh) {
					mesh.parent?.remove(mesh);
					mesh.dispose();
				}
			}
			this.shafts = this.heads = null;
			if (poses.length === 0)
				return;
			const capacity = Math.max(poses.length, 64);
			this.shafts = new THREE.InstancedMesh(this.shaftGeometry, this.meshMaterial, capacity);
			this.heads = new THREE.InstancedMesh(this.headGeometry, this.meshMaterial, capacity);
			for (const mesh of [this.shafts, this.heads]) {
				mesh.frustumCulled = false;
				this.add(mesh);
			}
		}
		const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), t = new THREE.Vector3();
		poses.forEach(({ position: p, orientation: o, length }, i) => {
			m.compose(t.set(p.x, p.y, p.z), q.set(o.x, o.y, o.z, o.w), s.setScalar(length));
			this.shafts.setMatrixAt(i, m);
			this.heads.setMatrixAt(i, m);
		});
		for (const mesh of [this.shafts, this.heads]) {
			mesh.count = poses.length;
			mesh.instanceMatrix.needsUpdate = true;
		}
	}

	applyColor() {
		const opacity = this.props.alpha;
		this.lineMaterial.color.set(this.props.color);
		this.meshMaterial.color.set(this.props.color);
		this.lineMaterial.opacity = this.meshMaterial.opacity = opacity;
		this.meshMaterial.depthWrite = opacity >= 1;
	}

	onPropertyChange(key) {
		if (key === "color" || key === "alpha") {
			this.applyColor();
			this.requestRender();
		}
		if (key === "min_length" || key === "max_length" || key === "shape")
			this.rebuild();
		if (key === "topic") {
			this.message = null;
			this.poses = [];
			this.flat.visible = this.axes.visible = false;
			this.buildArrows3d([]);
			this.setInfo({});
		}
	}

	onDestroy() {
		this.buildArrows3d([]);
		for (const disposable of [this.flat.geometry, this.axes.geometry, this.lineMaterial, this.axesMaterial, this.meshMaterial, this.shaftGeometry, this.headGeometry])
			disposable.dispose();
	}
}
