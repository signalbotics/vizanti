import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarker, markerKey, markerExpired, MARKER } from '../../public/js/geometry/markers.js';
import { MarkerArrayDisplay } from '../../public/js/displays/markerarray.js';
import { defaultsOf } from '../../public/js/core/properties.js';

const base = (type, extra = {}) => ({
	ns: "a", id: 1, type, action: 0,
	pose: { position: { x: 1, y: 2, z: 3 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
	scale: { x: 1, y: 2, z: 3 }, color: { r: 1, g: 0, b: 0, a: 0.5 },
	lifetime: { sec: 0, nanosec: 0 }, points: [], colors: [], text: "", ...extra,
});
const meshes = (object) => { const out = []; object.traverse((o) => { if (o.isMesh || o.isPoints || o.isLineSegments || o.isLine) out.push(o); }); return out; };

test('markerKey separates namespaces and ids', () => {
	assert.notEqual(markerKey({ ns: "a", id: 11 }), markerKey({ ns: "a1", id: 1 }));
});

test('a cube is a scaled box at the marker pose, in the marker colour', () => {
	const built = buildMarker(base(MARKER.CUBE));
	assert.deepEqual(built.object.position.toArray(), [1, 2, 3]);
	const [mesh] = meshes(built.object);
	assert.equal(mesh.geometry.type, "BoxGeometry");
	assert.deepEqual(mesh.scale.toArray(), [1, 2, 3]);
	assert.equal(mesh.material.color.getHexString(), "ff0000");
	assert.equal(mesh.material.opacity, 0.5);
});

test('spheres and cylinders are real solids', () => {
	assert.equal(meshes(buildMarker(base(MARKER.SPHERE)).object)[0].geometry.type, "SphereGeometry");
	assert.equal(meshes(buildMarker(base(MARKER.CYLINDER)).object)[0].geometry.type, "CylinderGeometry");
});

test('an arrow has a shaft and a head; two points define its ends', () => {
	assert.equal(meshes(buildMarker(base(MARKER.ARROW)).object).length, 2);
	const between = buildMarker(base(MARKER.ARROW, { points: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 4, z: 0 }], scale: { x: 0.1, y: 0.2, z: 0.5 } }));
	assert.equal(meshes(between.object).length, 2);
});

test('line strips and line lists become segments', () => {
	const pts = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }];
	const strip = meshes(buildMarker(base(MARKER.LINE_STRIP, { points: pts })).object)[0];
	assert.equal(strip.geometry.attributes.position.count, 6);
	const list = meshes(buildMarker(base(MARKER.LINE_LIST, { points: pts })).object)[0];
	assert.equal(list.geometry.attributes.position.count, 4);
});

test('cube and sphere lists are instanced, one instance per point, with per-point colours', () => {
	const pts = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }];
	const colors = [{ r: 1, g: 0, b: 0, a: 1 }, { r: 0, g: 1, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 }];
	for (const type of [MARKER.CUBE_LIST, MARKER.SPHERE_LIST]) {
		const mesh = meshes(buildMarker(base(type, { points: pts, colors })).object)[0];
		assert.equal(mesh.isInstancedMesh, true);
		assert.equal(mesh.count, 3);
		assert.ok(mesh.instanceColor);
	}
});

test('points markers are supported', () => {
	const built = buildMarker(base(MARKER.POINTS, { points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 }] }));
	const [points] = meshes(built.object);
	assert.equal(points.isPoints, true);
	assert.equal(points.geometry.attributes.position.count, 2);
	assert.equal(built.warning, undefined);
});

test('triangle lists keep every triangle, scaled, with vertex or face colours', () => {
	const pts = Array.from({ length: 6 }, (_, i) => ({ x: i, y: 0, z: 0 }));
	const face = buildMarker(base(MARKER.TRIANGLE_LIST, { points: pts, colors: [{ r: 0, g: 1, b: 0, a: 1 }, { r: 0, g: 0, b: 1, a: 1 }] }));
	const mesh = meshes(face.object)[0];
	assert.equal(mesh.geometry.attributes.position.count, 6);
	assert.equal(mesh.geometry.attributes.position.array[3], 1); // x scaled by 1
	assert.deepEqual([...mesh.geometry.attributes.color.array.slice(0, 3)], [0, 1, 0]);
	assert.deepEqual([...mesh.geometry.attributes.color.array.slice(9, 12)], [0, 0, 1]);
});

test('text markers carry their text for the overlay, and mesh resources are reported', () => {
	const text = buildMarker(base(MARKER.TEXT_VIEW_FACING, { text: "hello\nworld" }));
	assert.deepEqual(text.text, { lines: ["hello", "world"], height: 3, color: "rgba(255, 0, 0, 0.5)", outline: "#FFFFFF" });
	assert.match(buildMarker(base(99)).warning, /Unknown marker type 99/);
});

test('an all-zero orientation is treated as identity', () => {
	const m = base(MARKER.CUBE);
	m.pose.orientation = { x: 0, y: 0, z: 0, w: 0 };
	assert.deepEqual(buildMarker(m).object.quaternion.toArray(), [0, 0, 0, 1]);
});

test('markerExpired respects the lifetime, and zero means forever', () => {
	assert.equal(markerExpired({ sec: 0, nanosec: 0 }, 0, 1e12), false);
	assert.equal(markerExpired({ sec: 2, nanosec: 0 }, 1000, 2500), false);
	assert.equal(markerExpired({ sec: 2, nanosec: 0 }, 1000, 3500), true);
	assert.equal(markerExpired(undefined, 0, 1e12), false);
});

test('MarkerArrayDisplay keeps the options of the widget it replaces', () => {
	assert.equal(MarkerArrayDisplay.type, "markerarray");
	assert.deepEqual(defaultsOf(MarkerArrayDisplay.properties), { topic: "", opacity: 1, throttle: 100, disabled_namespaces: {} });
	assert.deepEqual(MarkerArrayDisplay.fromLegacy({ topic: "/m", disabled_namespaces: ["a", "b"] }).disabled_namespaces, { a: true, b: true });
});
