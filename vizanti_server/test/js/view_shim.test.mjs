import test from 'node:test';
import assert from 'node:assert/strict';

// the shim reads the scene from the page's app object
let hit = { x: 3, y: 4, z: 0 };
let projected = { x: 10, y: 20, visible: true };
globalThis.window = {
	vizanti: {
		scene: {
			container: { getBoundingClientRect: () => ({ left: 100, top: 50 }) },
			groundPoint: () => hit,
			project: () => projected,
			pixelsPerMeter: () => 40,
			viewTarget: () => ({ x: 1, y: 2 }),
			setInputEnabled() {},
			resetCamera() {},
		},
	},
};
const { view } = await import('../../public/js/modules/view.js');

test('screenToFixed returns the ground point under the pointer', () => {
	assert.deepEqual(view.screenToFixed({ x: 5, y: 5 }), { x: 3, y: 4, z: 0 });
	assert.equal(view.groundMissed, false);
});

test('a pointer that misses the ground keeps the last good point instead of jumping to the origin', () => {
	view.screenToFixed({ x: 5, y: 5 });
	hit = null;
	assert.deepEqual(view.screenToFixed({ x: 5, y: 900 }), { x: 3, y: 4, z: 0 });
	assert.equal(view.groundMissed, true);
	hit = { x: 7, y: 8, z: 0 };
	assert.deepEqual(view.screenToFixed({ x: 5, y: 5 }), { x: 7, y: 8, z: 0 });
	assert.equal(view.groundMissed, false);
});

test('fixedToScreen gives window coordinates, and sends points behind the camera off screen', () => {
	assert.deepEqual(view.fixedToScreen({ x: 0, y: 0 }), { x: 110, y: 70, z: 0 });
	projected = { x: 10, y: 20, visible: false };
	const p = view.fixedToScreen({ x: 0, y: 0 });
	assert.ok(p.x < -10000 && p.y < -10000);
	projected = { x: 10, y: 20, visible: true };
});

test('scale and unit conversions follow the camera', () => {
	assert.equal(view.scale, 40);
	assert.equal(view.getMapUnitsInPixels(2), 80);
	assert.equal(view.getPixelsInMapUnits(80), 2);
});
