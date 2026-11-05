import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SELECTORS, pluginNames, initialItems, choose } from '../vizanti/selector_logic.js';
import { parameterUnset } from '../vizanti/selector_logic.js';

test('the six selectors read the RViz panel parameters and publish on its topics', () => {
	assert.deepEqual(SELECTORS.map((s) => `${s.server}:${s.parameter}->${s.topic}`), [
		'controller_server:controller_plugins->controller_selector',
		'planner_server:planner_plugins->planner_selector',
		'controller_server:goal_checker_plugins->goal_checker_selector',
		'smoother_server:smoother_plugins->smoother_selector',
		'controller_server:progress_checker_plugins->progress_checker_selector',
		'controller_server:path_handler_plugins->path_handler_selector',
	]);
});

test('plugin names come from a string array parameter; anything else is not loaded', () => {
	assert.deepEqual(pluginNames({ values: [{ type: 9, string_array_value: ['FollowPath', 'Fast'] }] }), ['FollowPath', 'Fast']);
	assert.equal(pluginNames({ values: [{ type: 0 }] }), null);
	assert.equal(pluginNames({ values: [] }), null);
	assert.equal(pluginNames(undefined), null);
	assert.deepEqual(initialItems(['A', 'B']), ['Default', 'A', 'B']);
});

test('a choice drops "Default" and publishes the plugin', () => {
	assert.deepEqual(choose(['Default', 'A', 'B'], 'B'), { items: ['A', 'B'], selected: 'B', publish: 'B' });
	// choosing "Default" itself lands on the next item, as the Qt combo box does
	assert.deepEqual(choose(['Default', 'A', 'B'], 'Default'), { items: ['A', 'B'], selected: 'A', publish: 'A' });
	assert.deepEqual(choose(['A', 'B'], 'A'), { items: ['A', 'B'], selected: 'A', publish: 'A' });
	assert.deepEqual(choose(['Default'], 'Default'), { items: [], selected: null, publish: null });
});

test('a parameter the server does not have (Path Handler on Humble / Jazzy) is told apart from no answer', () => {
	assert.equal(parameterUnset({ values: [{ type: 0 }] }), true);
	assert.equal(parameterUnset({ values: [{ type: 9, string_array_value: ['FollowPath'] }] }), false);
	assert.equal(parameterUnset({ values: [] }), true);
});
