// Compatibility layer for widgets written against the old 2D view. Screen coordinates are
// window (client) coordinates; fixed-frame points are projected through the 3D camera onto
// the z = 0 plane, so the tools keep working in the top-down and the orbit view.
function scene() {
	return window.vizanti.scene;
}

export class View {

	constructor() {
		this.input_movement = true;
	}

	get scale() {
		return scene().pixelsPerMeter();
	}

	get center() {
		const target = scene().viewTarget();
		return { x: target.x, y: -target.y };
	}

	fixedToScreen(coords) {
		const rect = scene().container.getBoundingClientRect();
		const p = scene().project(coords.x, coords.y, coords.z ?? 0);
		return { x: p.x + rect.left, y: p.y + rect.top, z: 0 };
	}

	screenToFixed(coords) {
		return scene().groundPoint(coords.x, coords.y) ?? { x: 0, y: 0, z: 0 };
	}

	quaterionToProjectionMatrix(quaternion) {
		const w = quaternion.w, x = -quaternion.x, y = quaternion.y, z = -quaternion.z;
		return [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * y - w * z), 1 - 2 * (x * x + z * z)];
	}

	getPixelsInMapUnits(length) {
		return length / this.scale;
	}

	getMapUnitsInPixels(length) {
		return length * this.scale;
	}

	setInputMovementEnabled(value) {
		this.input_movement = value;
		scene().setInputEnabled(value);
	}

	reset() {
		scene().resetCamera();
	}
}

export let view = new View();
