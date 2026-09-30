// Pure maths and messages for interactive markers (visualization_msgs/InteractiveMarker).

export const INTERACTION = {
	NONE: 0, MENU: 1, BUTTON: 2, MOVE_AXIS: 3, MOVE_PLANE: 4, ROTATE_AXIS: 5,
	MOVE_ROTATE: 6, MOVE_3D: 7, ROTATE_3D: 8, MOVE_ROTATE_3D: 9,
};

export const FEEDBACK = { KEEP_ALIVE: 0, POSE_UPDATE: 1, MENU_SELECT: 2, BUTTON_CLICK: 3, MOUSE_DOWN: 4, MOUSE_UP: 5 };

const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
const unit = (a) => {
	const n = Math.hypot(a.x, a.y, a.z);
	return n > 0 ? { x: a.x / n, y: a.y / n, z: a.z / n } : null;
};

// Distance along the (normalised) line from linePoint to the point on the line closest to the
// ray. Null when the ray runs parallel to the line.
export function closestParamOnLine(rayOrigin, rayDir, linePoint, lineDir) {
	const d1 = rayDir, d2 = unit(lineDir);
	if (!d2)
		return null;
	const w0 = sub(linePoint, rayOrigin);
	const a = dot(d1, d1), b = dot(d1, d2), c = dot(d2, d2);
	const d = dot(d1, w0), e = dot(d2, w0);
	const denominator = a * c - b * b;
	if (Math.abs(denominator) < 1e-12)
		return null;
	return (b * d - a * e) / denominator;
}

// Where a ray meets a plane, or null when it misses or runs along it.
export function rayPlane(rayOrigin, rayDir, planePoint, normal) {
	const denominator = dot(rayDir, normal);
	if (Math.abs(denominator) < 1e-12)
		return null;
	const t = dot(sub(planePoint, rayOrigin), normal) / denominator;
	if (t < 0)
		return null;
	return { x: rayOrigin.x + rayDir.x * t, y: rayOrigin.y + rayDir.y * t, z: rayOrigin.z + rayDir.z * t };
}

// The angle from a to b turning about axis (right-handed), in radians.
export function signedAngle(a, b, axis) {
	const n = unit(axis);
	return Math.atan2(dot(n, cross(a, b)), dot(a, b));
}

// The handles RViz adds to a control that brings no markers of its own.
export function autoControls(control) {
	if (control.markers && control.markers.length)
		return [];
	switch (control.interaction_mode) {
		case INTERACTION.MOVE_AXIS:
			return [{ kind: "arrow", direction: 1 }, { kind: "arrow", direction: -1 }];
		case INTERACTION.ROTATE_AXIS:
		case INTERACTION.MOVE_ROTATE:
			return [{ kind: "ring" }];
	}
	return [];
}

// handles are tinted by the direction of their axis: x red, y green, z blue
export function axisColor(axis) {
	const n = unit(axis) ?? { x: 1, y: 1, z: 1 };
	return [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
}

export function feedbackMessage({ frame, stamp, clientId, marker, control, event, pose, menuEntry = 0, mousePoint = null }) {
	return {
		header: { frame_id: frame, stamp },
		client_id: clientId,
		marker_name: marker,
		control_name: control,
		event_type: event,
		pose,
		menu_entry_id: menuEntry,
		mouse_point: mousePoint ?? { x: 0, y: 0, z: 0 },
		mouse_point_valid: !!mousePoint,
	};
}
