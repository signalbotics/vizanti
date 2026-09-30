import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from '../../public/js/lib/three.module.min.js';

const lib = new URL('../../public/js/lib/', import.meta.url);
const read = (p) => readFileSync(new URL(p, lib), 'utf8');

test('three.js is the pinned revision', () => {
	assert.equal(THREE.REVISION, '160');
});

test('three addons import three by bare specifier, resolved by the import map', () => {
	for (const p of [
		'three_addons/controls/OrbitControls.js',
		'three_addons/lines/LineSegments2.js',
		'three_addons/lines/LineSegmentsGeometry.js',
		'three_addons/lines/LineMaterial.js',
	]) {
		assert.match(read(p), /from 'three'/, p);
	}
});

test('dockview-core is the pinned version and exposes createDockview', () => {
	const src = read('dockview-core.min.js');
	assert.match(src, /@version 8\.3\.1/);
	assert.match(src, /createDockview/);
});
