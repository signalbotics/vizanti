import { Display } from '../core/display.js';
import { FlatMesh } from '../core/flat_mesh.js';
import { posesToArrows } from '../geometry/shapes.js';

export class PoseArrayDisplay extends Display {

	static type = "posearray";
	static label = "Pose Array";
	static icon = "assets/posearray.svg";
	static description = "geometry_msgs/PoseArray, nav2_msgs/ParticleCloud";
	static msgTypes = ["geometry_msgs/msg/PoseArray", "nav2_msgs/msg/ParticleCloud"];

	// above this many poses each one is drawn as a plain triangle
	static simpleAbove = 100;

	static properties = {
		topic: { type: "topic", label: "Topic" },
		topic_type: { type: "string", hidden: true },
		color: { type: "color", label: "Colour", default: "#f74127" },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 100, min: 0, max: 10000 },
		scale: { type: "float", label: "Arrow scale", default: 1.0, min: 0.1, max: 10, step: 0.01, slider: true },
	};

	onCreate() {
		this.arrows = new FlatMesh(this.props.color);
		this.add(this.arrows.mesh);
		this.poses = [];
	}

	rebuild() {
		this.arrows.setTriangles(posesToArrows(this.poses, this.props.scale, this.poses.length >= PoseArrayDisplay.simpleAbove));
	}

	onMessage(msg) {
		if (!this.setFrame(msg.header, { follow: true })) {
			this.poses = [];
			this.rebuild();
			return;
		}
		this.poses = this.topicType === "nav2_msgs/msg/ParticleCloud"
			? (msg.particles ?? []).map((p) => p.pose)
			: (msg.poses ?? []);
		this.rebuild();
		this.setInfo({ "Frame": msg.header.frame_id, "Poses": this.poses.length });
	}

	onPropertyChange(key, value) {
		if (key === "color")
			this.arrows.material.color.set(value);
		if (key === "topic") {
			this.poses = [];
			this.setInfo({});
		}
		if (key === "scale" || key === "topic")
			this.rebuild();
	}

	onDestroy() {
		this.arrows.dispose();
	}
}
