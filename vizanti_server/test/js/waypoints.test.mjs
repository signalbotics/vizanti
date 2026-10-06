import test from 'node:test';
import assert from 'node:assert/strict';
import { insertIndex, nearestPoint, closestIndex, waypointPoses, parseWaypointCsv, marginSegments, fromLegacyWaypoints } from '../../public/js/geometry/waypoints.js';

const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;
const P = (x, y, z = 0) => ({ x, y, z });

test('a click near a segment inserts there; elsewhere it appends', () => {
	const pts = [P(0, 0), P(10, 0), P(10, 10)];
	assert.equal(insertIndex(pts, P(5, 0.3), 0.5), 1, "between the first two");
	assert.equal(insertIndex(pts, P(10.2, 5), 0.5), 2, "between the last two");
	assert.equal(insertIndex(pts, P(5, 3), 0.5), 3, "far from every segment: appended");
	assert.equal(insertIndex([], P(1, 1), 0.5), 0);
	assert.equal(insertIndex([P(0, 0)], P(0.1, 0), 0.5), 1);
});

test('nearestPoint finds a point within the tolerance, closest first', () => {
	const pts = [P(0, 0), P(1, 0), P(5, 5)];
	assert.equal(nearestPoint(pts, P(0.9, 0.1), 0.3), 1);
	assert.equal(nearestPoint(pts, P(3, 3), 0.3), -1);
	assert.equal(nearestPoint(pts, P(0.45, 0), 0.5), 0, "ties go to the closer one");
});

test('closestIndex picks the waypoint nearest the robot (2D)', () => {
	const pts = [P(0, 0), P(10, 0, 50), P(20, 0)];
	assert.equal(closestIndex(pts, { x: 11, y: 1 }), 1);
	assert.equal(closestIndex([], { x: 0, y: 0 }), 0);
});

test('waypointPoses face the next waypoint; the last faces along the final leg', () => {
	const poses = waypointPoses([P(0, 0, 1), P(0, 5, 2), P(5, 5, 3)]);
	const yaw = (q) => 2 * Math.atan2(q.z, q.w);
	assert.deepEqual(poses.map((p) => p.position), [P(0, 0, 1), P(0, 5, 2), P(5, 5, 3)]);
	assert.ok(near(yaw(poses[0].orientation), Math.PI / 2));
	assert.ok(near(yaw(poses[1].orientation), 0));
	assert.ok(near(yaw(poses[2].orientation), 0));
	assert.deepEqual(waypointPoses([P(1, 2)])[0].orientation, { x: 0, y: 0, z: 0, w: 1 });
	assert.deepEqual(waypointPoses([]), []);
});

test('parseWaypointCsv reads x,y[,z] rows and skips headers, blanks and junk', () => {
	const text = "x,y,z\n1,2,3\n\n4.5, -6 \nfoo,bar\n7;8;9\n";
	assert.deepEqual(parseWaypointCsv(text), [P(1, 2, 3), P(4.5, -6, 0), P(7, 8, 9)]);
});

test('marginSegments gives a left and right line per leg at the margin distance', () => {
	const segs = marginSegments([P(0, 0), P(10, 0)], 1);
	assert.equal(segs.length, 2);
	const ys = segs.map((s) => [s[0].y, s[1].y]).flat().sort();
	assert.deepEqual(ys, [-1, -1, 1, 1]);
	assert.deepEqual(marginSegments([P(0, 0)], 1), []);
	assert.deepEqual(marginSegments([P(0, 0), P(1, 0)], 0), []);
});

test('fromLegacyWaypoints carries over the old widget settings', () => {
	const props = fromLegacyWaypoints({
		topic: "/mission", topic_type: "geometry_msgs/msg/PoseArray", fixed_frame: "map",
		base_link_frame: "base_footprint", points: [{ x: 1, y: 2 }, { x: 3, y: 4, z: 5 }], start_closest: true, margin: "1.5",
	});
	assert.deepEqual(props, {
		mission_topic: "/mission", message_type: "geometry_msgs/msg/PoseArray", frame: "map", robot_frame: "base_footprint",
		points: [P(1, 2, 0), P(3, 4, 5)], start_closest: true, margin: 1.5,
	});
	assert.deepEqual(fromLegacyWaypoints({}).points, []);
});

import { boxPolygon } from '../../public/js/geometry/waypoints.js';

test('boxPolygon turns a dragged diagonal into the four corners, in the old widget order', () => {
	assert.deepEqual(boxPolygon({ x: 1, y: 2 }, { x: 4, y: -1 }), [
		{ x: 1, y: 2, z: 0 }, { x: 4, y: 2, z: 0 }, { x: 4, y: -1, z: 0 }, { x: 1, y: -1, z: 0 },
	]);
});
