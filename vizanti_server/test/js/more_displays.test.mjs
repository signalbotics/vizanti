import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../public/js/lib/three.module.min.js';
import { loopSegments } from '../../public/js/geometry/shapes.js';
import { vectorPair, VECTOR_TYPES } from '../../public/js/geometry/vectors.js';
import { imageToRGBA } from '../../public/js/geometry/image.js';
import { makeArrow } from '../../public/js/core/arrow.js';
import { buildMarker, MARKER } from '../../public/js/geometry/markers.js';
import { Display } from '../../public/js/core/display.js';
import { FrameNodes } from '../../public/js/core/frames.js';
import { MarkerDisplay } from '../../public/js/displays/marker.js';
import { PointStampedDisplay } from '../../public/js/displays/pointstamped.js';
import { WrenchDisplay } from '../../public/js/displays/wrench.js';
import { PolygonDisplay } from '../../public/js/displays/polygon.js';
import { AxesDisplay } from '../../public/js/displays/axes.js';
import { ImageDisplay } from '../../public/js/displays/image.js';
import { defaultsOf } from '../../public/js/core/properties.js';

const near = (a, b) => Math.abs(a - b) < 1e-6;

test('loopSegments closes the outline and needs at least two points', () => {
	const s = loopSegments([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }]);
	assert.equal(s.length, 3 * 6);
	assert.deepEqual([...s.slice(12)], [1, 1, 0, 0, 0, 0]);
	assert.equal(loopSegments([{ x: 0, y: 0, z: 0 }]).length, 0);
	assert.equal(loopSegments([{ x: 0, y: 0, z: 0 }, { x: NaN, y: 0, z: 0 }]).length, 0);
});

test('vectorPair reads the linear and angular parts of wrench, twist and accel messages', () => {
	const v = (x) => ({ x, y: 0, z: 0 });
	assert.deepEqual(vectorPair({ wrench: { force: v(1), torque: v(2) } }, "geometry_msgs/msg/WrenchStamped"), { linear: v(1), angular: v(2) });
	assert.deepEqual(vectorPair({ twist: { linear: v(3), angular: v(4) } }, "geometry_msgs/msg/TwistStamped"), { linear: v(3), angular: v(4) });
	assert.deepEqual(vectorPair({ accel: { linear: v(5), angular: v(6) } }, "geometry_msgs/msg/AccelStamped"), { linear: v(5), angular: v(6) });
	assert.equal(vectorPair({}, "geometry_msgs/msg/WrenchStamped"), null);
	assert.equal(vectorPair({ wrench: { force: { x: NaN, y: 0, z: 0 }, torque: v(0) } }, "geometry_msgs/msg/WrenchStamped"), null);
	assert.equal(VECTOR_TYPES.length, 3);
});

test('makeArrow builds a shaft and head of the requested total length along +x', () => {
	const arrow = makeArrow(2, 0.05, 0.1, 0.4, new THREE.MeshBasicMaterial());
	const box = new THREE.Box3().setFromObject(arrow);
	assert.ok(near(box.min.x, 0) && near(box.max.x, 2));
	assert.equal(arrow.children.length, 2);
	// a head longer than the arrow is shortened instead of pointing backwards
	const short = new THREE.Box3().setFromObject(makeArrow(0.1, 0.05, 0.1, 0.4, new THREE.MeshBasicMaterial()));
	assert.ok(near(short.min.x, 0) && near(short.max.x, 0.1));
});

const image = (encoding, bytes, width, height, extra = {}) => ({ encoding, width, height, step: bytes.length / height, is_bigendian: 0, data: Uint8Array.from(bytes), ...extra });

test('imageToRGBA converts the common colour encodings', () => {
	assert.deepEqual([...imageToRGBA(image("rgb8", [1, 2, 3], 1, 1)).rgba], [1, 2, 3, 255]);
	assert.deepEqual([...imageToRGBA(image("bgr8", [1, 2, 3], 1, 1)).rgba], [3, 2, 1, 255]);
	assert.deepEqual([...imageToRGBA(image("rgba8", [1, 2, 3, 4], 1, 1)).rgba], [1, 2, 3, 4]);
	assert.deepEqual([...imageToRGBA(image("bgra8", [1, 2, 3, 4], 1, 1)).rgba], [3, 2, 1, 4]);
	assert.deepEqual([...imageToRGBA(image("mono8", [9, 200], 2, 1)).rgba], [9, 9, 9, 255, 200, 200, 200, 255]);
});

test('imageToRGBA stretches 16-bit and float depth images to the visible range', () => {
	// little-endian 0 and 1000
	const r = imageToRGBA(image("16UC1", [0, 0, 0xe8, 0x03], 2, 1));
	assert.deepEqual([...r.rgba], [0, 0, 0, 255, 255, 255, 255, 255]);
	const f = new Uint8Array(new Float32Array([1, 3, NaN]).buffer);
	const d = imageToRGBA(image("32FC1", [...f], 3, 1));
	assert.deepEqual([...d.rgba.slice(0, 8)], [0, 0, 0, 255, 255, 255, 255, 255]);
	assert.equal(d.rgba[11], 0); // a NaN depth is transparent
});

test('imageToRGBA honours row padding, accepts base64, and reports what it cannot show', () => {
	// 1x2 mono8 image with a step of 3 bytes per row
	assert.deepEqual([...imageToRGBA({ encoding: "mono8", width: 1, height: 2, step: 3, data: Uint8Array.from([7, 0, 0, 8, 0, 0]) }).rgba], [7, 7, 7, 255, 8, 8, 8, 255]);
	assert.deepEqual([...imageToRGBA({ encoding: "rgb8", width: 1, height: 1, step: 3, data: Buffer.from([5, 6, 7]).toString("base64") }).rgba], [5, 6, 7, 255]);
	assert.match(imageToRGBA(image("yuv422", [0, 0], 1, 1)).error, /yuv422.*not supported/);
	assert.match(imageToRGBA({ encoding: "rgb8", width: 4, height: 4, step: 12, data: Uint8Array.from([1, 2, 3]) }).error, /smaller than/);
	assert.match(imageToRGBA({ encoding: "rgb8", width: 0, height: 0, step: 0, data: new Uint8Array(0) }).error, /empty/);
});

test('mesh resource markers carry what is needed to load the mesh', () => {
	const built = buildMarker({
		type: MARKER.MESH_RESOURCE, pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
		scale: { x: 2, y: 2, z: 2 }, color: { r: 1, g: 0, b: 0, a: 1 }, mesh_resource: "package://p/m.stl", mesh_use_embedded_materials: false,
	});
	assert.deepEqual(built.mesh, { filename: "package://p/m.stl", scale: [2, 2, 2], color: [1, 0, 0, 1], embedded: false });
	assert.equal(built.warning, undefined);
});

test('Display.toFixed places a stamped point in the fixed frame', () => {
	const S = Math.SQRT1_2;
	const tf = {
		fixed_frame: "odom",
		absoluteTransforms: { base: { translation: { x: 1, y: 2, z: 3 }, rotation: { w: S, x: 0, y: 0, z: S } } },
		getAbsoluteTransform(h) { return this.absoluteTransforms[h.frame_id]; },
	};
	const ctx = { tf, frames: new FrameNodes(tf), requestRender() {}, subscribe: () => () => {}, setProperty() {} };
	class P extends Display { static type = "p"; }
	const d = new P("p_0", ctx);
	d._create({}, true);
	const p = d.toFixed({ frame_id: "base" }, { x: 1, y: 0, z: 0 });
	assert.ok(near(p.x, 1) && near(p.y, 3) && near(p.z, 3));
	assert.deepEqual(d.toFixed({ frame_id: "odom" }, { x: 4, y: 5, z: 6 }), { x: 4, y: 5, z: 6 });
	assert.equal(d.toFixed({ frame_id: "nowhere" }, { x: 0, y: 0, z: 0 }), null);
	assert.equal(d.status.level, "error");
});

test('the new displays declare their types and defaults', () => {
	assert.deepEqual([MarkerDisplay.type, MarkerDisplay.msgTypes[0]], ["marker", "visualization_msgs/msg/Marker"]);
	assert.deepEqual(defaultsOf(PointStampedDisplay.properties), { topic: "", color: "#cc29cc", radius: 0.2, history: 1, opacity: 1, throttle: 100 });
	assert.deepEqual(WrenchDisplay.msgTypes, VECTOR_TYPES);
	assert.deepEqual(defaultsOf(WrenchDisplay.properties), { topic: "", topic_type: "", linear_color: "#cc3333", angular_color: "#cccc33", linear_scale: 1, angular_scale: 1, width: 0.05, opacity: 1, throttle: 100 });
	assert.deepEqual(defaultsOf(PolygonDisplay.properties), { topic: "", color: "#19ff00", thickness: 2, opacity: 1, throttle: 100 });
	assert.deepEqual(defaultsOf(AxesDisplay.properties), { frame: "", length: 1, radius: 0.05, opacity: 1 });
	assert.deepEqual(defaultsOf(ImageDisplay.properties), { topic: "", size: 320, corner: "top-left", opacity: 1, throttle: 200 });
});
