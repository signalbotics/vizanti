import test from 'node:test';
import assert from 'node:assert/strict';
import { throttled } from '../../public/js/core/throttle.js';

test('throttled runs once after a burst', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let n = 0;
	const run = throttled(() => n++, 400);
	run(); run(); run();
	assert.equal(n, 0);
	t.mock.timers.tick(400);
	assert.equal(n, 1);
	run();
	t.mock.timers.tick(400);
	assert.equal(n, 2);
});

test('cancel drops a pending run and ignores later calls, so a save cannot land after a reset', (t) => {
	t.mock.timers.enable({ apis: ['setTimeout'] });
	let n = 0;
	const run = throttled(() => n++, 400);
	run();
	run.cancel();
	t.mock.timers.tick(1000);
	run();
	t.mock.timers.tick(1000);
	assert.equal(n, 0);
});
