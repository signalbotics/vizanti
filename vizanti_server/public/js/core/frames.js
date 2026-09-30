import * as THREE from '../lib/three.module.min.js';

// One scene node per TF frame, positioned from tf.absoluteTransforms (each frame's pose in
// the fixed frame). A display that parents its objects to a node follows that frame for free.
export class FrameNodes {

	constructor(tf) {
		this.tf = tf;
		this.root = new THREE.Group();
		this.root.name = "fixed_frame";
		this.nodes = new Map();
	}

	_apply(node, frame) {
		const abs = this.tf.absoluteTransforms[frame];
		if (!abs) {
			// the fixed frame sits at the origin even before it shows up in TF
			node.visible = frame === this.tf.fixed_frame;
			node.position.set(0, 0, 0);
			node.quaternion.set(0, 0, 0, 1);
			return;
		}
		node.visible = true;
		node.position.set(abs.translation.x, abs.translation.y, abs.translation.z);
		node.quaternion.set(abs.rotation.x, abs.rotation.y, abs.rotation.z, abs.rotation.w);
	}

	get(frame) {
		if (frame === "")
			return this.root;

		let node = this.nodes.get(frame);
		if (node)
			return node;

		if (!this.tf.absoluteTransforms[frame] && frame !== this.tf.fixed_frame)
			return null;

		node = new THREE.Group();
		node.name = frame;
		this.nodes.set(frame, node);
		this.root.add(node);
		this._apply(node, frame);
		return node;
	}

	update() {
		for (const [frame, node] of this.nodes) {
			if (node.children.length === 0) {
				node.removeFromParent();
				this.nodes.delete(frame);
				continue;
			}
			this._apply(node, frame);
		}
	}
}
