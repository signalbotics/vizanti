import * as THREE from '../lib/three.module.min.js';
import { Display } from './display.js';

export const HIT_PX = 14; // how close (screen pixels) a press must be to grab a point

// Base for displays whose points are edited in the 3D view (Waypoints, Survey): the points live
// in a chosen frame (props.frame, the fixed frame when empty) and are picked on screen.
export class PointEditorDisplay extends Display {

	// attaches the display to its frame's node; false while that frame is not in TF yet
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

	// a point in the display's frame -> canvas pixels ({ x, y, visible })
	screenOf(p) {
		const world = new THREE.Vector3(p.x, p.y, p.z ?? 0);
		this.root.localToWorld(world);
		return this.ctx.scene.project(world.x, world.y, world.z);
	}

	// index of the point under the pointer (within HIT_PX), or -1
	hitIndex(points, event) {
		const rect = this.ctx.scene.canvas.getBoundingClientRect();
		const x = event.clientX - rect.left, y = event.clientY - rect.top;
		let best = -1, bestDistance = HIT_PX;
		points.forEach((p, i) => {
			const s = this.screenOf(p);
			const d = Math.hypot(s.x - x, s.y - y);
			if (s.visible && d <= bestDistance) {
				best = i;
				bestDistance = d;
			}
		});
		return best;
	}

	// a point in the fixed frame (a ground hit, a TF translation) -> the display's frame
	toLocal(p) {
		this.root.updateWorldMatrix(true, false);
		return this.root.worldToLocal(new THREE.Vector3(p.x, p.y, p.z ?? 0));
	}

	// metres per screen pixel at the view's focus
	metersPerPixel() {
		return 1 / Math.max(1e-6, this.ctx.scene.pixelsPerMeter());
	}

	// the robot's position in the display's frame, or null when its frame is unknown
	robotLocal(frame) {
		const robot = this.ctx.tf.absoluteTransforms[frame];
		return robot ? this.toLocal(robot.translation) : null;
	}
}
