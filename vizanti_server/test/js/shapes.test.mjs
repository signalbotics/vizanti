import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuat, posesToArrows, pathSegments, pathLength, formatDistance, rangeSector, cellQuads } from '../../public/js/geometry/shapes.js';
import { PathDisplay } from '../../public/js/displays/path.js';
import { PoseArrayDisplay } from '../../public/js/displays/posearray.js';
import { RangeDisplay } from '../../public/js/displays/range.js';
import { GridCellsDisplay } from '../../public/js/displays/gridcells.js';
import { defaultsOf } from '../../public/js/core/properties.js';

const S = Math.SQRT1_2;
const near = (a, b) => Math.abs(a - b) < 1e-5;
const pose = (x, y, z, q = { x: 0, y: 0, z: 0, w: 1 }) => ({ position: { x, y, z }, orientation: q });

test('normalizeQuat turns an all-zero or missing quaternion into identity', () => {
	assert.deepEqual(normalizeQuat({ x: 0, y: 0, z: 0, w: 0 }), { x: 0, y: 0, z: 0, w: 1 });
	assert.deepEqual(normalizeQuat(undefined), { x: 0, y: 0, z: 0, w: 1 });
	assert.deepEqual(normalizeQuat({ x: 0, y: 0, z: S, w: S }), { x: 0, y: 0, z: S, w: S });
});

test('posesToArrows draws a three-triangle arrow per pose, pointing along the pose x axis', () => {
	const a = posesToArrows([pose(1, 2, 3)], 2, false);
	assert.equal(a.length, 3 * 3 * 3);
	// the tip is the point furthest along +x: half a metre times the scale
	let maxX = -Infinity;
	for (let i = 0; i < a.length; i += 3) maxX = Math.max(maxX, a[i]);
	assert.ok(near(maxX, 1 + 0.5 * 2));
	for (let i = 2; i < a.length; i += 3) assert.ok(near(a[i], 3));
});

test('posesToArrows rotates with the pose and uses single triangles when asked', () => {
	const a = posesToArrows([pose(0, 0, 0, { x: 0, y: 0, z: S, w: S })], 1, true);
	assert.equal(a.length, 9);
	// tip of the simple triangle is 0.3 m along the rotated x axis, which is +y
	assert.ok(near(a[3], 0) && near(a[4], 0.3));
});

test('posesToArrows skips poses with a non-finite position', () => {
	assert.equal(posesToArrows([pose(NaN, 0, 0), pose(0, null, 0), pose(1, 1, 1)], 1, true).length, 9);
});

test('pathSegments joins consecutive points and skips broken ones', () => {
	const s = pathSegments([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: NaN, y: 0, z: 0 }, { x: 1, y: 2, z: 0 }]);
	assert.deepEqual([...s], [0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 2, 0]);
	assert.equal(pathSegments([{ x: 0, y: 0, z: 0 }]).length, 0);
	assert.equal(pathSegments([]).length, 0);
});

test('pathLength sums segment lengths and formatDistance picks the unit', () => {
	assert.equal(pathLength([{ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 }, { x: 3, y: 4, z: 2 }]), 7);
	assert.equal(formatDistance(7), "7.00 m");
	assert.equal(formatDistance(0.256), "25.6 cm");
	assert.equal(formatDistance(1234.5), "1.234 km");
});

test('rangeSector builds a ring sector centred on +x between two radii', () => {
	const s = rangeSector(1, 2, Math.PI / 2, 4);
	assert.equal(s.length, 4 * 2 * 9);
	let minR = Infinity, maxR = 0, maxAngle = 0;
	for (let i = 0; i < s.length; i += 3) {
		const r = Math.hypot(s[i], s[i + 1]);
		minR = Math.min(minR, r);
		maxR = Math.max(maxR, r);
		maxAngle = Math.max(maxAngle, Math.abs(Math.atan2(s[i + 1], s[i])));
		assert.equal(s[i + 2], 0);
	}
	assert.ok(near(minR, 1) && near(maxR, 2) && near(maxAngle, Math.PI / 4));
});

test('rangeSector gives nothing for an empty or inverted range', () => {
	assert.equal(rangeSector(2, 2, 1).length, 0);
	assert.equal(rangeSector(3, 1, 1).length, 0);
	assert.equal(rangeSector(0, 1, 0).length, 0);
	assert.equal(rangeSector(0, NaN, 1).length, 0);
});

test('cellQuads draws one quad per cell, centred on the cell', () => {
	const r = cellQuads([{ x: 1, y: 2, z: 0.5 }], 0.2, 0.4);
	assert.equal(r.count, 1);
	assert.equal(r.positions.length, 18);
	const xs = [], ys = [];
	for (let i = 0; i < 18; i += 3) { xs.push(r.positions[i]); ys.push(r.positions[i + 1]); assert.ok(near(r.positions[i + 2], 0.5)); }
	assert.ok(near(Math.min(...xs), 0.9) && near(Math.max(...xs), 1.1));
	assert.ok(near(Math.min(...ys), 1.8) && near(Math.max(...ys), 2.2));
});

test('cellQuads thins grids over the budget and skips broken cells', () => {
	const cells = Array.from({ length: 10 }, (_, i) => ({ x: i, y: 0, z: 0 }));
	const r = cellQuads(cells, 1, 1, 5);
	assert.deepEqual([r.count, r.stride], [5, 2]);
	assert.equal(cellQuads([{ x: NaN, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }], 1, 1).count, 1);
});

test('the four displays keep the options and defaults of the widgets they replace', () => {
	assert.deepEqual(defaultsOf(PathDisplay.properties), { topic: "", color: "#54db67", opacity: 1, throttle: 100 });
	assert.deepEqual(defaultsOf(PoseArrayDisplay.properties), { topic: "", topic_type: "", color: "#f74127", throttle: 100, scale: 1 });
	assert.deepEqual(PoseArrayDisplay.msgTypes, ["geometry_msgs/msg/PoseArray", "nav2_msgs/msg/ParticleCloud"]);
	assert.deepEqual(defaultsOf(RangeDisplay.properties), { topic: "", throttle: 100, decay: 2000, opacity: 0.9 });
	assert.deepEqual(defaultsOf(GridCellsDisplay.properties), { topic: "", opacity: 1, color: "#74ce6c", throttle: 500, use_timestamp: false });
	assert.deepEqual([PathDisplay.type, PoseArrayDisplay.type, RangeDisplay.type, GridCellsDisplay.type], ["path", "posearray", "range", "gridcells"]);
});

test('normalizeQuat normalises quaternions that are not unit length', () => {
	const q = normalizeQuat({ x: 1, y: 0, z: 0, w: 1 });
	assert.ok(near(q.x, Math.SQRT1_2) && near(q.w, Math.SQRT1_2) && q.y === 0 && q.z === 0);
});
