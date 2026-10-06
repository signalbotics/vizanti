// Recent objects of a display (point clouds, scans) kept where they were measured.
// Objects live under the display's root, which a display moves to its newest message's pose;
// each older object gets root^-1 * (its own pose) so it stays put in the fixed frame.
export class Trail {

	constructor(root) {
		this.root = root;
		this.items = []; // { object, pose (Matrix4, relative to root's parent), time }
	}

	// pose: where the root was (relative to its parent) when this object's data arrived
	push(object, pose, time) {
		object.matrixAutoUpdate = false;
		this.root.add(object);
		this.items.push({ object, pose: pose.clone(), time });
		this.place();
	}

	place() {
		this.root.updateMatrix();
		const inverse = this.root.matrix.clone().invert();
		for (const { object, pose } of this.items) {
			object.matrix.multiplyMatrices(inverse, pose);
			object.matrixWorldNeedsUpdate = true;
		}
	}

	// Removes entries older than decayMs (the newest always stays). Returns whether any went.
	expire(decayMs, now) {
		let removed = false;
		while (this.items.length > 1 && now - this.items[0].time > decayMs) {
			this.dispose(this.items.shift().object);
			removed = true;
		}
		return removed;
	}

	clear() {
		for (const { object } of this.items)
			this.dispose(object);
		this.items = [];
	}

	dispose(object) {
		object.removeFromParent();
		object.geometry?.dispose();
	}
}

