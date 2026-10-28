import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RouteGraph, parseNumber, parseId } from '../vizanti/route_graph_logic.js';

// nav2_route's own sample graph (nav2_route/graphs/sample_graph.geojson)
const sample = readFileSync(new URL('./fixtures/sample_graph.geojson', import.meta.url), 'utf8');

test('loads nav2_route GeoJSON: nodes, edges, next id after the largest', () => {
	const g = RouteGraph.fromGeoJson(sample);
	const doc = JSON.parse(sample);
	const points = doc.features.filter((f) => f.geometry.type === 'Point');
	assert.equal(g.nodes.size, points.length);
	assert.equal(g.edges.size, doc.features.length - points.length);
	assert.equal(g.nextId, Math.max(...doc.features.map((f) => f.properties.id)) + 1);
	assert.deepEqual(g.nodes.get(0).metadata.region.properties, { class_type: 'living_room', number_of_lights: 10 });
	assert.equal(g.edges.get(9).start, 0);
	assert.equal(g.edges.get(9).cost, 10);
});

test('saves what it loaded (metadata and operations kept)', () => {
	const g = RouteGraph.fromGeoJson(sample);
	const again = RouteGraph.fromGeoJson(g.toGeoJson());
	assert.deepEqual([...again.nodes.values()], [...g.nodes.values()]);
	assert.deepEqual([...again.edges.values()], [...g.edges.values()]);
	const out = JSON.parse(g.toGeoJson());
	assert.equal(out.type, 'FeatureCollection');
	assert.equal(out.crs.properties.name, 'urn:ogc:def:crs:EPSG::3857');
	assert.deepEqual(out.features.find((f) => f.properties.id === 9).properties.operations, JSON.parse(sample).features.find((f) => f.properties.id === 9).properties.operations);
});

test('add, edit, remove; removing a node takes its edges both ways', () => {
	const g = new RouteGraph();
	const a = g.addNode(0, 0), b = g.addNode(1, 0), c = g.addNode(1, 1);
	const ab = g.addEdge(a, b), bc = g.addEdge(b, c), ca = g.addEdge(c, a);
	assert.deepEqual([a, b, c, ab, bc, ca], [0, 1, 2, 3, 4, 5]); // one counter, as in RViz
	g.editNode(b, 2, 0);
	assert.deepEqual([g.nodes.get(b).x, g.nodes.get(b).y], [2, 0]);
	g.editEdge(ab, b, a);
	assert.deepEqual([g.edges.get(ab).start, g.edges.get(ab).end], [b, a]);
	assert.throws(() => g.addEdge(a, 99), /no node 99/);
	assert.throws(() => g.editEdge(42, a, b), /no edge 42/);
	g.removeNode(a);
	assert.deepEqual([...g.edges.keys()], [bc]);
	g.removeEdge(bc);
	assert.equal(g.edges.size, 0);
	assert.throws(() => g.removeEdge(bc), /no edge/);
});

test('markers as nav2_route draws them, after a DELETEALL', () => {
	const g = new RouteGraph();
	const a = g.addNode(0, 0), b = g.addNode(2, 0);
	g.addEdge(a, b);
	const { markers } = g.markers();
	assert.equal(markers[0].action, 3);
	const nodes = markers.find((m) => m.ns === 'route_graph_nodes');
	const edges = markers.find((m) => m.ns === 'route_graph_edges');
	assert.equal(nodes.type, 7);
	assert.deepEqual(nodes.points, [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]);
	assert.equal(edges.type, 5);
	assert.deepEqual(edges.points, [{ x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }]);
	assert.deepEqual(markers.filter((m) => m.ns === 'route_graph_node_ids').map((m) => m.text), ['0', '1']);
	const edgeLabel = markers.find((m) => m.ns === 'route_graph_edge_ids');
	assert.equal(edgeLabel.text, '2');
	assert.deepEqual([edgeLabel.pose.position.x, edgeLabel.pose.position.y], [1.07, -0.05]);
});

test('bad files and fields', () => {
	assert.throws(() => RouteGraph.fromGeoJson('nope'), /not JSON/);
	assert.throws(() => RouteGraph.fromGeoJson('{}'), /no GeoJSON features/);
	assert.throws(() => RouteGraph.fromGeoJson(JSON.stringify({ features: [{ geometry: { type: 'MultiLineString' }, properties: { id: 1, startid: 0, endid: 2 } }] })), /does not join/);
	assert.equal(parseNumber(' 1.5 '), 1.5);
	assert.equal(parseNumber(''), null);
	assert.equal(parseNumber('x'), null);
	assert.equal(parseId('3'), 3);
	assert.equal(parseId('3.5'), null);
	assert.equal(parseId('-1'), null);
});
