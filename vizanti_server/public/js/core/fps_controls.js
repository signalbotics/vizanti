// First-person camera, as RViz's FPS view: drag to look around, the wheel and arrow keys
// to move. The camera state is the same position + look point the orbit camera uses, so
// switching between the two keeps the view.

const PITCH_LIMIT = Math.PI / 2 - 0.02; // straight up or down has no defined yaw
const LOOK_SPEED = 0.005;  // radians per pixel dragged
const WHEEL_STEP = 0.5;    // metres per wheel notch
const KEY_STEP = 0.25;     // metres per key press; Shift moves four times as far

export function viewAngles(position, target) {
	const dx = target[0] - position[0];
	const dy = target[1] - position[1];
	const dz = target[2] - position[2];
	const distance = Math.hypot(dx, dy, dz);
	return { yaw: Math.atan2(dy, dx), pitch: Math.asin(distance > 0 ? dz / distance : 0), distance };
}

// The look point after turning the view by dYaw (left positive) and dPitch (up positive).
export function turn(position, target, dYaw, dPitch) {
	const { yaw, pitch, distance } = viewAngles(position, target);
	const y = yaw + dYaw;
	const p = Math.min(PITCH_LIMIT, Math.max(-PITCH_LIMIT, pitch + dPitch));
	return [
		position[0] + distance * Math.cos(p) * Math.cos(y),
		position[1] + distance * Math.cos(p) * Math.sin(y),
		position[2] + distance * Math.sin(p),
	];
}

// Moves camera and look point together: forward along the view, right on the level, up along z.
export function translate(position, target, forward, right, up) {
	const { yaw, pitch } = viewAngles(position, target);
	const f = [Math.cos(pitch) * Math.cos(yaw), Math.cos(pitch) * Math.sin(yaw), Math.sin(pitch)];
	const r = [Math.sin(yaw), -Math.cos(yaw), 0];
	const offset = [0, 1, 2].map((i) => forward * f[i] + right * r[i] + (i === 2 ? up : 0));
	return {
		position: position.map((v, i) => v + offset[i]),
		target: target.map((v, i) => v + offset[i]),
	};
}

const KEYS = {
	ArrowUp: [1, 0, 0],
	ArrowDown: [-1, 0, 0],
	ArrowRight: [0, 1, 0],
	ArrowLeft: [0, -1, 0],
	PageUp: [0, 0, 1],
	PageDown: [0, 0, -1],
};

// camera: a THREE.PerspectiveCamera; target: the THREE.Vector3 look point (shared with the
// orbit controls); onChange: called after every move.
export class FpsControls {

	constructor(camera, target, element, onChange) {
		this.camera = camera;
		this.target = target;
		this.element = element;
		this.onChange = onChange;
		this.enabled = false;
		this._drag = null;
		this._hover = false;

		element.addEventListener("pointerdown", (event) => {
			if (!this.enabled)
				return;
			this._drag = { x: event.clientX, y: event.clientY, look: event.button === 0 };
			element.setPointerCapture?.(event.pointerId);
		});
		element.addEventListener("pointermove", (event) => {
			if (!this.enabled || !this._drag)
				return;
			const dx = event.clientX - this._drag.x;
			const dy = event.clientY - this._drag.y;
			this._drag.x = event.clientX;
			this._drag.y = event.clientY;
			if (this._drag.look) {
				// mouse-look: drag left to turn left, drag up to look up
				this._apply(this._position(), turn(this._position(), this._target(), -dx * LOOK_SPEED, -dy * LOOK_SPEED));
			} else {
				// other buttons slide the camera sideways and up, about a centimetre per pixel
				const moved = translate(this._position(), this._target(), 0, -dx * 0.01, dy * 0.01);
				this._apply(moved.position, moved.target);
			}
		});
		const end = () => { this._drag = null; };
		element.addEventListener("pointerup", end);
		element.addEventListener("pointercancel", end);
		element.addEventListener("wheel", (event) => {
			if (!this.enabled)
				return;
			event.preventDefault();
			this.move(-Math.sign(event.deltaY) * WHEEL_STEP, 0, 0);
		}, { passive: false });

		// arrow keys only while the pointer is over the view, so they still scroll panels
		element.addEventListener("pointerenter", () => { this._hover = true; });
		element.addEventListener("pointerleave", () => { this._hover = false; });
		window.addEventListener("keydown", (event) => {
			const direction = KEYS[event.key];
			if (!this.enabled || !this._hover || !direction || event.ctrlKey || event.metaKey || event.altKey)
				return;
			const t = event.target;
			if (t && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName)))
				return;
			event.preventDefault();
			const step = KEY_STEP * (event.shiftKey ? 4 : 1);
			this.move(direction[0] * step, direction[1] * step, direction[2] * step);
		});
	}

	move(forward, right, up) {
		const moved = translate(this._position(), this._target(), forward, right, up);
		this._apply(moved.position, moved.target);
	}

	_position() { return this.camera.position.toArray(); }
	_target() { return this.target.toArray(); }

	_apply(position, target) {
		this.camera.position.fromArray(position);
		this.target.fromArray(target);
		this.camera.lookAt(this.target);
		this.onChange();
	}
}
