export const MIN_ZOOM = 0.001;
export const MAX_ZOOM = 5000;

// zoom is CSS pixels per metre
export const DEFAULT_CAMERA = {
	mode: "topdown",
	target_frame: "",
	topdown: { x: 0, y: 0, zoom: 50 },
	orbit: { target: [0, 0, 0], position: [-6, -6, 5] },
};

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const num = (v, fallback) => (isNum(v) ? v : fallback);
const isVec3 = (v) => Array.isArray(v) && v.length === 3 && v.every(isNum);

export function sanitizeCameraState(state) {
	const src = state !== null && typeof state === "object" && !Array.isArray(state) ? state : {};
	const td = src.topdown !== null && typeof src.topdown === "object" ? src.topdown : {};
	const ob = src.orbit !== null && typeof src.orbit === "object" ? src.orbit : {};

	let target = DEFAULT_CAMERA.orbit.target;
	let position = DEFAULT_CAMERA.orbit.position;
	if (isVec3(ob.target) && isVec3(ob.position)) {
		// a camera sitting exactly on its target has no view direction
		if (ob.target.some((v, i) => v !== ob.position[i])) {
			target = ob.target;
			position = ob.position;
		}
	}

	return {
		mode: src.mode === "orbit" ? "orbit" : "topdown",
		target_frame: typeof src.target_frame === "string" ? src.target_frame : "",
		topdown: {
			x: num(td.x, DEFAULT_CAMERA.topdown.x),
			y: num(td.y, DEFAULT_CAMERA.topdown.y),
			zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, num(td.zoom, DEFAULT_CAMERA.topdown.zoom))),
		},
		orbit: { target: [...target], position: [...position] },
	};
}
