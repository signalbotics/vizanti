import test from 'node:test';
import assert from 'node:assert/strict';
import { paramMap, parsePoints, circlePoints, zonesFrom, stateText, actionStyle } from '../vizanti/collision_monitor_logic.js';
import { topicOfNode } from '../vizanti/nav2_names.js';

test('points: Iron+ strings and Humble flat arrays', () => {
	assert.deepEqual(parsePoints('[[0.3, 0.3], [0.3, -0.3], [-0.2, -0.3], [-0.2, 0.3]]'), [{ x: 0.3, y: 0.3 }, { x: 0.3, y: -0.3 }, { x: -0.2, y: -0.3 }, { x: -0.2, y: 0.3 }]);
	assert.deepEqual(parsePoints([0.3, 0.3, 0.3, -0.3, -0.2, 0]), [{ x: 0.3, y: 0.3 }, { x: 0.3, y: -0.3 }, { x: -0.2, y: 0 }]);
	assert.equal(parsePoints('[[1, 2]]'), null); // not a polygon
	assert.equal(parsePoints(null), null);
	const c = circlePoints(0.5, 4);
	assert.ok(Math.abs(c[1].y - 0.5) < 1e-12 && Math.abs(c[1].x) < 1e-12);
});

test('zones from the parameters: polygon, circle, footprint, published, and the bringup default', () => {
	const values = (vs) => ({ values: vs });
	const top = paramMap(['polygons', 'base_frame_id'], values([{ type: 9, string_array_value: ['PolygonStop', 'Slow', 'FootprintApproach', 'Velocity'] }, { type: 4, string_value: 'base_link' }]));
	const perZone = {
		'PolygonStop.type': 'polygon', 'PolygonStop.action_type': 'stop', 'PolygonStop.points': '[[0.3, 0.3], [0.3, -0.3], [0.0, -0.3], [0.0, 0.3]]', 'PolygonStop.enabled': true,
		'Slow.type': 'circle', 'Slow.action_type': 'slowdown', 'Slow.radius': 0.8, 'Slow.enabled': false,
		'FootprintApproach.type': 'polygon', 'FootprintApproach.action_type': 'approach', 'FootprintApproach.footprint_topic': 'local_costmap/published_footprint', 'FootprintApproach.visualize': false,
		'Velocity.type': 'velocity_polygon', 'Velocity.action_type': 'stop', 'Velocity.visualize': true, 'Velocity.polygon_pub_topic': 'velocity_polygon',
	};
	const zones = zonesFrom(top, perZone);
	assert.deepEqual(zones.map((z) => [z.name, z.shape, z.action.key, z.enabled, z.frame]), [
		['PolygonStop', 'points', 'stop', true, 'base_link'],
		['Slow', 'points', 'slowdown', false, 'base_link'],
		['FootprintApproach', 'footprint', 'approach', true, 'base_link'],
		['Velocity', 'published', 'stop', true, 'base_link'],
	]);
	assert.equal(zones[1].points.length, 48);
	assert.equal(topicOfNode('collision_monitor', zones[2].topic), '/local_costmap/published_footprint');
	assert.equal(topicOfNode('/robot1/collision_monitor', zones[2].topic), '/robot1/local_costmap/published_footprint');
	assert.equal(topicOfNode('collision_monitor', zones[3].topic), '/velocity_polygon');
	assert.equal(actionStyle('stop').color, '#ff3b30');
});

test('state: which zone acts', () => {
	assert.equal(stateText({ action_type: 1, polygon_name: 'PolygonStop' }), 'Stop: PolygonStop');
	assert.equal(stateText({ action_type: 3, polygon_name: 'FootprintApproach' }), 'Approach: FootprintApproach');
	assert.equal(stateText({ action_type: 0, polygon_name: '' }), 'Nothing in any zone');
});
