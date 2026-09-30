import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScale, fitGrid, gridLines, scaleLabel, MAX_LINES } from '../../public/js/geometry/grid.js';
import { GridDisplay } from '../../public/js/displays/grid.js';
import { defaultsOf } from '../../public/js/core/properties.js';

test('calculateScale snaps to 1, 2, 5 times a power of ten', () => {
	assert.equal(calculateScale(1.2), 1);
	assert.equal(calculateScale(3), 2);
	assert.equal(calculateScale(4), 5);
	assert.equal(calculateScale(8), 10);
	assert.equal(calculateScale(0.03), 0.02);
	assert.equal(calculateScale(740), 500);
});

test('fitGrid keeps the chosen step when autoscale is off and it fits', () => {
	assert.deepEqual(
		fitGrid({ step: 1, subdivisions: 2, autoscale: "Off", visibleMeters: 20, radius: 15 }),
		{ step: 1, subdivisions: 2, tooDense: false }
	);
});

test('fitGrid derives the step from the visible size when autoscale is on', () => {
	assert.equal(fitGrid({ step: 1, subdivisions: 1, autoscale: "Coarse", visibleMeters: 70, radius: 50 }).step, 10);
	assert.equal(fitGrid({ step: 1, subdivisions: 1, autoscale: "Very Fine", visibleMeters: 21, radius: 15 }).step, 1);
	assert.equal(fitGrid({ step: 1, subdivisions: 1, autoscale: "Rough", visibleMeters: 3, radius: 2 }).step, 1);
});

test('fitGrid drops subdivisions before it gives up', () => {
	const r = fitGrid({ step: 1, subdivisions: 10, autoscale: "Off", visibleMeters: 100, radius: 100 });
	assert.equal(r.tooDense, false);
	assert.equal(r.subdivisions, 1);
});

test('fitGrid reports too dense with autoscale off, and widens the step with it on', () => {
	assert.equal(fitGrid({ step: 0.01, subdivisions: 1, autoscale: "Off", visibleMeters: 100, radius: 100 }).tooDense, true);
	const r = fitGrid({ step: 1, subdivisions: 1, autoscale: "Very Fine", visibleMeters: 1, radius: 5000 });
	assert.equal(r.tooDense, false);
	assert.ok((2 * 5000) / r.step <= MAX_LINES);
});

test('gridLines covers n cells either side of the centre cell, ends on grid lines', () => {
	const g = gridLines({ step: 2, subdivisions: 1, ci: 1, cj: 0, n: 1 });
	// x lines at 0, 2, 4 and y lines at -2, 0, 2: six segments
	assert.equal(g.main.length, 6 * 6);
	assert.equal(g.sub.length, 0);
	assert.deepEqual([...g.main.slice(0, 6)], [0, -2, 0, 0, 2, 0]);
	assert.deepEqual([...g.main.slice(18, 24)], [0, -2, 0, 4, -2, 0]);
});

test('gridLines puts subdivision lines between the main lines only', () => {
	const g = gridLines({ step: 1, subdivisions: 4, ci: 0, cj: 0, n: 1 });
	// 2 cells per axis x 3 inner lines x 2 axes
	assert.equal(g.sub.length, 12 * 6);
	const xs = new Set();
	for (let i = 0; i < g.sub.length; i += 6)
		if (g.sub[i] === g.sub[i + 3]) xs.add(g.sub[i]);
	assert.deepEqual([...xs].sort((a, b) => a - b), [-0.75, -0.5, -0.25, 0.25, 0.5, 0.75]);
});

test('scaleLabel picks a readable unit', () => {
	assert.equal(scaleLabel(2), "2 m");
	assert.equal(scaleLabel(5000), "5 km");
	assert.equal(scaleLabel(0.2), "20 cm");
});

test('GridDisplay declares every option the current grid widget has', () => {
	assert.equal(GridDisplay.type, "grid");
	assert.deepEqual(defaultsOf(GridDisplay.properties), {
		frame: "", autoscale: "Coarse", size: 1, thickness: 1, colour: "#3e556a",
		subdivisions: 2, colour_sub: "#294056",
	});
});
