import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../public/js/lib/three.module.min.js';
import { Trail } from '../../public/js/core/trail.js';

const pose = (x) => new THREE.Matrix4().makeTranslation(x, 0, 0);
const entry = () => new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial());

test('a trail keeps each object at the pose it arrived with while the root moves on', () => {
	const root = new THREE.Group();
	const trail = new Trail(root);
	root.position.set(1, 0, 0);
	trail.push(entry(), pose(1), 0);
	root.position.set(3, 0, 0);
	trail.push(entry(), pose(3), 100);
	root.updateMatrixWorld(true);
	const worldX = trail.items.map(({ object }) => new THREE.Vector3().setFromMatrixPosition(object.matrixWorld).x);
	assert.deepEqual(worldX, [1, 3]);
	assert.equal(root.children.length, 2);
});

test('expire drops entries older than the decay time but always keeps the newest', () => {
	const root = new THREE.Group();
	const trail = new Trail(root);
	trail.push(entry(), pose(0), 0);
	trail.push(entry(), pose(0), 500);
	trail.push(entry(), pose(0), 900);
	assert.equal(trail.expire(1000, 1200), true);
	assert.equal(trail.items.length, 2);
	assert.equal(trail.expire(1000, 5000), true);
	assert.equal(trail.items.length, 1, "the newest stays even when old");
	assert.equal(trail.expire(1000, 9000), false);
	assert.equal(root.children.length, 1);
});

test('clear removes and disposes everything', () => {
	const root = new THREE.Group();
	const trail = new Trail(root);
	const a = entry();
	let disposed = false;
	a.geometry.dispose = () => { disposed = true; };
	trail.push(a, pose(0), 0);
	trail.clear();
	assert.equal(trail.items.length, 0);
	assert.equal(root.children.length, 0);
	assert.equal(disposed, true);
});
