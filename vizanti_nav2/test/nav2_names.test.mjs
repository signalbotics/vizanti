import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNamespace, inNamespace, servicesIn, clearableCostmaps, costmapsToAsk, topicOfNode } from '../vizanti/nav2_names.js';

test('a Nav2 namespace goes in front of every name, once', () => {
	assert.equal(normalizeNamespace(' /robot1/ '), '/robot1');
	assert.equal(normalizeNamespace(''), '');
	assert.equal(inNamespace('', '/spin'), '/spin');
	assert.equal(inNamespace('robot1', '/spin'), '/robot1/spin');
	assert.equal(inNamespace('/robot1', 'docking_server/get_parameters'), '/robot1/docking_server/get_parameters');
	assert.equal(inNamespace('robot1', '/robot1/spin'), '/robot1/spin'); // already in it
	assert.equal(inNamespace('a/b', '/spin'), '/a/b/spin');
});

test('costmaps are found by service type, in the namespace, under any name', () => {
	const services = ['/robot2/local_costmap/clear_entirely_local_costmap', '/robot1/local_costmap/clear_entirely_local_costmap', '/robot1/global_costmap/clear_entirely_global_costmap'];
	assert.deepEqual(clearableCostmaps('robot1', services).map((c) => [c.service, c.label]), [
		['/robot1/global_costmap/clear_entirely_global_costmap', 'Global costmap'],
		['/robot1/local_costmap/clear_entirely_local_costmap', 'Local costmap'],
	]);
	// no namespace set: every robot's, told apart by their namespace
	assert.deepEqual(clearableCostmaps('', services).map((c) => c.label), ['Robot1 global costmap', 'Robot1 local costmap', 'Robot2 local costmap']);
	// the default single robot
	assert.deepEqual(clearableCostmaps('', ['/global_costmap/clear_entirely_global_costmap']).map((c) => c.label), ['Global costmap']);
	// a costmap node with another name
	assert.deepEqual(clearableCostmaps('', ['/docking_costmap/clear_entirely_docking_costmap']).map((c) => c.label), ['Docking costmap']);
	const ask = costmapsToAsk(['/robot1/local_costmap/get_cost_local_costmap']);
	assert.deepEqual(ask.map((c) => [c.node, c.label]), [['/robot1/local_costmap/local_costmap', 'Robot1 local costmap']]);
	assert.deepEqual(servicesIn('robot1', ['/robot1/map_saver/save_map', '/map_saver/save_map']), ['/robot1/map_saver/save_map']);
});

test('names a node gives relative to itself are in its namespace', () => {
	assert.equal(topicOfNode('lifecycle_manager_navigation', 'controller_server'), '/controller_server');
	assert.equal(topicOfNode('robot1/lifecycle_manager_navigation', 'controller_server'), '/robot1/controller_server');
	assert.equal(topicOfNode('/robot1/collision_monitor', '/abs/topic'), '/abs/topic');
});
