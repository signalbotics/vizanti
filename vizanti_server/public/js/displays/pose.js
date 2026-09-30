import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { FlatMesh } from '../core/flat_mesh.js';
import { normalizeQuat, rangeSector } from '../geometry/shapes.js';
import { covarianceEllipse, ellipseTriangles, longArrow, eulerFromQuat, yawSpread } from '../geometry/pose.js';

const POSE_STAMPED = "geometry_msgs/msg/PoseStamped";
const deg = (rad) => (rad * (180 / Math.PI)).toFixed(1) + "°";

export class PoseDisplay extends Display {

	static type = "posewithcovariancestamped";
	static label = "Pose";
	static icon = "assets/posewithcovariancestamped.svg";
	static description = "geometry_msgs/PoseWithCovarianceStamped, geometry_msgs/PoseStamped";
	static msgTypes = ["geometry_msgs/msg/PoseWithCovarianceStamped", POSE_STAMPED];

	static properties = {
		topic: {
			type: "topic", label: "Topic",
			help: "Note: Covariance rendering assumes a 2D pose for simplicity. Side effects may include inaccuracy in high roll/pitch orientations, ask your PhD if 2D covariance rendering is right for you.",
		},
		topic_type: { type: "string", hidden: true },
		rendermode: {
			type: "enum", label: "Render mode", default: "long_arrow",
			options: [{ value: "long_arrow", label: "Long Arrow" }, { value: "axes", label: "Axes" }],
		},
		throttle: { type: "int", label: "Socket throttle (ms)", default: 100, min: 0, max: 10000 },
		decay: { type: "int", label: "Decay time (ms)", default: 10000, min: -1, max: 100000 },
		color: { type: "color", label: "Colour", default: "#f74127" },
		scale: { type: "float", label: "Render scale", default: 1.0, min: 0.01, max: 15, step: 0.01, slider: true },
	};

	get icon() {
		return this.props.topic_type === POSE_STAMPED ? "assets/pose.svg" : PoseDisplay.icon;
	}

	onCreate() {
		const scene = this.ctx.scene;
		// covariance is drawn in the frame's axes; everything else turns with the pose
		this.ellipse = new FlatMesh("#cc33cc", 0.4);
		this.oriented = new THREE.Group();
		this.spread = new FlatMesh("#ffff00", 0.4);
		this.arrow = new FlatMesh(this.props.color);
		this.dot = new FlatMesh(this.props.color);
		this.axes = scene.makeLines({ vertexColors: true, linewidth: 0.1 * this.props.scale, worldUnits: true });
		this.oriented.add(this.spread.mesh, this.arrow.mesh, this.dot.mesh, this.axes);
		this.holder = new THREE.Group();
		this.holder.add(this.ellipse.mesh, this.oriented);
		this.holder.visible = false;
		this.add(this.holder);

		this.pose = null;
		this.stamp = 0;
		this.timer = setInterval(() => this.applyVisibility(), 250);
	}

	rebuild() {
		if (!this.pose)
			return;
		const scale = this.props.scale;
		const { covariance, invalid } = this.pose;

		const ellipse = covarianceEllipse(covariance);
		this.ellipse.setTriangles(ellipse ? ellipseTriangles(ellipse.rx, ellipse.ry, ellipse.theta) : new Float32Array(0));

		const spread = invalid ? 0 : yawSpread(covariance);
		this.spread.setTriangles(spread > 0 ? rangeSector(0, 2 * scale, spread) : new Float32Array(0));

		// an unusable rotation is shown as a dot, with no heading
		this.dot.setTriangles(invalid ? ellipseTriangles(0.2 * scale, 0.2 * scale, 0) : new Float32Array(0));

		const arrowMode = this.props.rendermode === "long_arrow";
		this.arrow.setTriangles(!invalid && arrowMode ? longArrow(scale) : new Float32Array(0));

		if (!invalid && !arrowMode) {
			this.axes.material.linewidth = 0.1 * scale;
			this.ctx.scene.setLinePositions(
				this.axes,
				new Float32Array([0, 0, 0, scale, 0, 0, 0, 0, 0, 0, scale, 0, 0, 0, 0, 0, 0, scale]),
				new Float32Array([0.75, 0, 0.035, 0.75, 0, 0.035, 0.13, 0.8, 0.12, 0.13, 0.8, 0.12, 0.008, 0.29, 0.77, 0.008, 0.29, 0.77])
			);
		} else {
			this.axes.visible = false;
		}
	}

	applyVisibility() {
		const fresh = this.props.decay <= 0 || Date.now() - this.stamp <= this.props.decay;
		const visible = !!this.pose && fresh;
		if (this.holder.visible !== visible) {
			this.holder.visible = visible;
			this.requestRender();
		}
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header)) {
			this.pose = null;
			this.applyVisibility();
			return;
		}
		const plain = this.topicType === POSE_STAMPED;
		const pose = plain ? msg.pose : msg.pose.pose;
		const raw = pose.orientation;
		const invalid = raw.x === 0 && raw.y === 0 && raw.z === 0 && raw.w === 0;
		if (invalid)
			this.status.warn("Received invalid rotation, defaulting to indentity quat.");
		const q = normalizeQuat(raw);

		this.pose = { covariance: plain ? undefined : msg.pose.covariance, invalid };
		this.stamp = Date.now();
		this.holder.position.set(pose.position.x, pose.position.y, pose.position.z);
		this.oriented.quaternion.set(q.x, q.y, q.z, q.w);
		this.rebuild();
		this.applyVisibility();

		const angles = eulerFromQuat(q);
		this.setInfo({
			"X": pose.position.x.toFixed(2) + " m",
			"Y": pose.position.y.toFixed(2) + " m",
			"Z": pose.position.z.toFixed(2) + " m",
			"Distance": Math.hypot(pose.position.x, pose.position.y, pose.position.z).toFixed(2) + " m",
			"Roll": deg(angles.roll),
			"Pitch": deg(angles.pitch),
			"Yaw": deg(angles.yaw),
		});
	}

	onPropertyChange(key, value) {
		if (key === "color") {
			this.arrow.material.color.set(value);
			this.dot.material.color.set(value);
		}
		if (key === "topic") {
			this.pose = null;
			this.setInfo({});
		}
		this.rebuild();
		this.applyVisibility();
	}

	onDestroy() {
		clearInterval(this.timer);
		for (const mesh of [this.ellipse, this.spread, this.arrow, this.dot])
			mesh.dispose();
		this.ctx.scene.disposeLines(this.axes);
	}
}
