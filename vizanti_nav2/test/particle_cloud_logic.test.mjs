import { test } from 'node:test';
import assert from 'node:assert/strict';
import { particleLength, particlePoses, flatArrowVertices, rvizColor, particleCloudFromRviz } from '../vizanti/particle_cloud_logic.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

test('arrow length follows the weight within [min, max]', () => {
	close(particleLength(0, 0.02, 0.3), 0.02);
	close(particleLength(0.5, 0.02, 0.3), 0.16);
	close(particleLength(1, 0.02, 0.3), 0.3);
	close(particleLength(7, 0.02, 0.3), 0.3);
	close(particleLength(-1, 0.02, 0.3), 0.02);
});

test('particles: unit orientations, lengths; a non-finite value refuses the message', () => {
	const msg = { particles: [{ pose: { position: { x: 1, y: 2, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 2 } }, weight: 1 }] };
	const [p] = particlePoses(msg, 0.02, 0.3);
	assert.deepEqual(p.orientation, { x: 0, y: 0, z: 0, w: 1 });
	close(p.length, 0.3);
	assert.equal(particlePoses({ particles: [{ pose: { position: { x: NaN, y: 0, z: 0 } }, weight: 1 }] }, 0, 1), null);
	assert.equal(particlePoses({ particles: [{ pose: { position: { x: 0, y: 0, z: 0 } }, weight: Infinity }] }, 0, 1), null);
	assert.deepEqual(particlePoses({}, 0, 1), []);
});

test('flat arrow: shaft to the tip, two head strokes back to 0.75 L, +/-0.2 L', () => {
	// facing +y (yaw 90 degrees), length 1, at (1, 1, 0)
	const s = Math.SQRT1_2;
	const v = [...flatArrowVertices([{ position: { x: 1, y: 1, z: 0 }, orientation: { x: 0, y: 0, z: s, w: s }, length: 1 }])];
	assert.equal(v.length, 18);
	const pts = [];
	for (let i = 0; i < 18; i += 3)
		pts.push(v.slice(i, i + 3).map((n) => Math.round(n * 1000) / 1000 + 0));
	assert.deepEqual(pts, [[1, 1, 0], [1, 2, 0], [1, 2, 0], [0.8, 1.75, 0], [1, 2, 0], [1.2, 1.75, 0]]);
});

test('RViz settings import', () => {
	assert.equal(rvizColor('255; 25; 0', null), '#ff1900');
	assert.equal(rvizColor('bad', '#000000'), '#000000');
	assert.deepEqual(particleCloudFromRviz({
		Class: 'nav2_rviz_plugins/ParticleCloud', Topic: { Value: '/particle_cloud', Depth: 5 },
		Shape: 'Arrow (3D)', Color: '0; 180; 0', Alpha: 0.5, 'Min Arrow Length': 0.05, 'Max Arrow Length': 0.4,
	}), { topic: '/particle_cloud', shape: 'Arrow (3D)', color: '#00b400', alpha: 0.5, min_length: 0.05, max_length: 0.4 });
	assert.deepEqual(particleCloudFromRviz({ Shape: 'Spheres' }), {});
});
