import * as THREE from '../lib/three.module.min.js';
import { normalizeQuat } from './shapes.js';

// visualization_msgs/Marker types
export const MARKER = {
	ARROW: 0, CUBE: 1, SPHERE: 2, CYLINDER: 3, LINE_STRIP: 4, LINE_LIST: 5, CUBE_LIST: 6,
	SPHERE_LIST: 7, POINTS: 8, TEXT_VIEW_FACING: 9, MESH_RESOURCE: 10, TRIANGLE_LIST: 11,
};

const clamp01 = (v) => Math.min(Math.max(Number(v) || 0, 0), 1);

export function markerKey(m) {
	return `${m.ns ?? ""}\u0000${m.id}`;
}

// lifetime of zero (or missing) means forever; times are in milliseconds
export function markerExpired(lifetime, stampMs, nowMs) {
	if (!lifetime)
		return false;
	const seconds = (lifetime.sec ?? 0) + (lifetime.nanosec ?? 0) * 1e-9;
	if (seconds <= 0)
		return false;
	return (nowMs - stampMs) / 1000 > seconds;
}

function rgbaString(c) {
	if (!c)
		return "white";
	return `rgba(${Math.round(clamp01(c.r) * 255)}, ${Math.round(clamp01(c.g) * 255)}, ${Math.round(clamp01(c.b) * 255)}, ${clamp01(c.a)})`;
}

function contrasting(c) {
	return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) > 0.5 ? "#161B21" : "#FFFFFF";
}

function solid(color, vertexColors = false) {
	const alpha = clamp01(color?.a ?? 1);
	const material = new THREE.MeshLambertMaterial({
		color: vertexColors ? 0xffffff : new THREE.Color(clamp01(color?.r), clamp01(color?.g), clamp01(color?.b)),
		opacity: alpha,
		transparent: alpha < 1,
		vertexColors,
		side: THREE.DoubleSide,
	});
	material.userData.alpha = alpha;
	return material;
}

function pointList(points) {
	const out = new Float32Array(points.length * 3);
	points.forEach((p, i) => { out[i * 3] = p.x; out[i * 3 + 1] = p.y; out[i * 3 + 2] = p.z; });
	return out;
}

// colours for `count` vertices: one per point when supplied, otherwise the marker colour
function colorList(m, count) {
	const out = new Float32Array(count * 3);
	const per = Array.isArray(m.colors) && m.colors.length >= count;
	for (let i = 0; i < count; i++) {
		const c = per ? m.colors[i] : m.color;
		out[i * 3] = clamp01(c?.r); out[i * 3 + 1] = clamp01(c?.g); out[i * 3 + 2] = clamp01(c?.b);
	}
	return out;
}

function defaultLines(positions, colors, m) {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	const alpha = clamp01(m.color?.a ?? 1);
	const material = new THREE.LineBasicMaterial({ vertexColors: true, opacity: alpha, transparent: alpha < 1 });
	material.userData.alpha = alpha;
	return new THREE.LineSegments(geometry, material);
}

function arrow(m) {
	const group = new THREE.Group();
	const material = solid(m.color);
	let length, shaftRadius, headRadius, headLength;

	if (m.points && m.points.length >= 2) {
		// from the first point to the second: scale.x shaft diameter, scale.y head diameter, scale.z head length
		const a = new THREE.Vector3(m.points[0].x, m.points[0].y, m.points[0].z);
		const b = new THREE.Vector3(m.points[1].x, m.points[1].y, m.points[1].z);
		const direction = b.clone().sub(a);
		length = direction.length();
		shaftRadius = m.scale.x / 2;
		headRadius = m.scale.y / 2;
		headLength = m.scale.z > 0 ? Math.min(m.scale.z, length) : 0.23 * length;
		group.position.copy(a);
		if (length > 0)
			group.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
	} else {
		// along +x: scale.x length, scale.y width, scale.z height
		length = m.scale.x;
		shaftRadius = 0.25;
		headRadius = 0.5;
		headLength = 0.23 * length;
		group.scale.set(1, m.scale.y, m.scale.z);
	}

	const shaftLength = Math.max(length - headLength, 0);
	const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16).rotateZ(-Math.PI / 2), material);
	shaft.position.x = shaftLength / 2;
	const head = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 16).rotateZ(-Math.PI / 2), material);
	head.position.x = shaftLength + headLength / 2;
	group.add(shaft, head);
	return group;
}

function instanced(geometry, m) {
	const mesh = new THREE.InstancedMesh(geometry, solid({ r: 1, g: 1, b: 1, a: m.color?.a ?? 1 }), m.points.length);
	const matrix = new THREE.Matrix4();
	const scale = new THREE.Vector3(m.scale.x, m.scale.y, m.scale.z);
	const rotation = new THREE.Quaternion();
	const colors = colorList(m, m.points.length);
	const color = new THREE.Color();
	m.points.forEach((p, i) => {
		matrix.compose(new THREE.Vector3(p.x, p.y, p.z), rotation, scale);
		mesh.setMatrixAt(i, matrix);
		mesh.setColorAt(i, color.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]));
	});
	mesh.frustumCulled = false;
	return mesh;
}

function triangles(m) {
	const count = m.points.length - (m.points.length % 3);
	const positions = new Float32Array(count * 3);
	const colors = new Float32Array(count * 3);
	const perVertex = Array.isArray(m.colors) && m.colors.length === m.points.length;
	const perFace = Array.isArray(m.colors) && m.colors.length > 0 && m.colors.length === m.points.length / 3;
	for (let i = 0; i < count; i++) {
		const p = m.points[i];
		positions[i * 3] = p.x * m.scale.x;
		positions[i * 3 + 1] = p.y * m.scale.y;
		positions[i * 3 + 2] = p.z * m.scale.z;
		const c = perVertex ? m.colors[i] : perFace ? m.colors[Math.floor(i / 3)] : m.color;
		colors[i * 3] = clamp01(c?.r); colors[i * 3 + 1] = clamp01(c?.g); colors[i * 3 + 2] = clamp01(c?.b);
	}
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
	geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
	geometry.computeVertexNormals();
	return new THREE.Mesh(geometry, solid({ a: m.color?.a > 0 ? m.color.a : 1 }, true));
}

// Builds the scene object for one marker, positioned at the marker pose (in the marker's frame).
//   options.makeLines(positions, colors, marker): custom line factory (fat lines in the browser)
// Returns { object, text?, warning? }; `text` is drawn by the caller as screen-facing text.
export function buildMarker(m, options = {}) {
	const object = new THREE.Group();
	const p = m.pose?.position ?? { x: 0, y: 0, z: 0 };
	const q = normalizeQuat(m.pose?.orientation);
	object.position.set(p.x, p.y, p.z);
	object.quaternion.set(q.x, q.y, q.z, q.w);

	const result = { object };
	const points = Array.isArray(m.points) ? m.points : [];
	const makeLines = options.makeLines ?? defaultLines;
	const scaled = (mesh) => { mesh.scale.set(m.scale.x, m.scale.y, m.scale.z); return mesh; };

	switch (m.type) {
		case MARKER.ARROW:
			object.add(arrow(m));
			break;
		case MARKER.CUBE:
			object.add(scaled(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), solid(m.color))));
			break;
		case MARKER.SPHERE:
			object.add(scaled(new THREE.Mesh(new THREE.SphereGeometry(0.5, 24, 16), solid(m.color))));
			break;
		case MARKER.CYLINDER:
			object.add(scaled(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1, 24).rotateX(Math.PI / 2), solid(m.color))));
			break;
		case MARKER.LINE_STRIP: {
			if (points.length < 2)
				break;
			const strip = [];
			const colors = [];
			const per = colorList(m, points.length);
			for (let i = 0; i < points.length - 1; i++) {
				strip.push(points[i], points[i + 1]);
				colors.push(per[i * 3], per[i * 3 + 1], per[i * 3 + 2], per[i * 3 + 3], per[i * 3 + 4], per[i * 3 + 5]);
			}
			object.add(makeLines(pointList(strip), new Float32Array(colors), m));
			break;
		}
		case MARKER.LINE_LIST: {
			const count = points.length - (points.length % 2);
			if (count < 2)
				break;
			const list = points.slice(0, count);
			object.add(makeLines(pointList(list), colorList(m, count), m));
			break;
		}
		case MARKER.CUBE_LIST:
			if (points.length)
				object.add(instanced(new THREE.BoxGeometry(1, 1, 1), m));
			break;
		case MARKER.SPHERE_LIST:
			if (points.length)
				object.add(instanced(new THREE.SphereGeometry(0.5, 12, 8), m));
			break;
		case MARKER.POINTS: {
			if (!points.length)
				break;
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.BufferAttribute(pointList(points), 3));
			geometry.setAttribute("color", new THREE.BufferAttribute(colorList(m, points.length), 3));
			const alpha = clamp01(m.color?.a ?? 1);
			const material = new THREE.PointsMaterial({ vertexColors: true, opacity: alpha, transparent: alpha < 1 });
			material.userData.alpha = alpha;
			const cloud = new THREE.Points(geometry, material);
			cloud.userData.pointMeters = m.scale.x; // the caller sizes points for the current camera
			cloud.frustumCulled = false;
			object.add(cloud);
			break;
		}
		case MARKER.TEXT_VIEW_FACING:
			result.text = {
				lines: String(m.text ?? "").split("\n"),
				height: m.scale.z,
				color: rgbaString(m.color),
				outline: contrasting(m.color ?? { r: 1, g: 1, b: 1 }),
			};
			break;
		case MARKER.MESH_RESOURCE:
			// loaded by the caller; the file has to be fetched
			result.mesh = {
				filename: m.mesh_resource,
				scale: [m.scale.x, m.scale.y, m.scale.z],
				color: [clamp01(m.color?.r), clamp01(m.color?.g), clamp01(m.color?.b), clamp01(m.color?.a ?? 1)],
				embedded: !!m.mesh_use_embedded_materials,
			};
			break;
		case MARKER.TRIANGLE_LIST:
			if (points.length >= 3)
				object.add(triangles(m));
			break;
		default:
			result.warning = `Unknown marker type ${m.type}.`;
	}
	return result;
}

export function disposeMarker(object) {
	object.traverse((child) => {
		if (child.isInstancedMesh)
			child.dispose();
		if (child.geometry)
			child.geometry.dispose();
		for (const material of child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [])
			material.dispose();
	});
}
