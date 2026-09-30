import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../public/js/lib/three.module.min.js';
import { FrameNodes } from '../../public/js/core/frames.js';

const S = Math.SQRT1_2;

function fakeTf() {
	return {
		fixed_frame: "odom",
		absoluteTransforms: {
			odom: { translation: { x: 0, y: 0, z: 0 }, rotation: { w: 1, x: 0, y: 0, z: 0 } },
			base_link: { translation: { x: 1, y: 2, z: 3 }, rotation: { w: S, x: 0, y: 0, z: S } },
		},
	};
}

test('an empty frame name means the fixed frame origin', () => {
	const frames = new FrameNodes(fakeTf());
	assert.equal(frames.get(""), frames.root);
});

test('a known frame gets a node at its pose, reused on later calls', () => {
	const frames = new FrameNodes(fakeTf());
	const node = frames.get("base_link");
	assert.equal(node.parent, frames.root);
	assert.deepEqual(node.position.toArray(), [1, 2, 3]);
	assert.deepEqual(node.quaternion.toArray(), [0, 0, S, S]);
	assert.equal(frames.get("base_link"), node);
});

test('an unknown frame returns null', () => {
	assert.equal(new FrameNodes(fakeTf()).get("camera"), null);
});

test('the fixed frame is usable before any TF has arrived', () => {
	const tf = { fixed_frame: "odom", absoluteTransforms: {} };
	const node = new FrameNodes(tf).get("odom");
	assert.deepEqual(node.position.toArray(), [0, 0, 0]);
	assert.equal(node.visible, true);
});

test('update follows TF, hides frames that vanished, and drops unused nodes', () => {
	const tf = fakeTf();
	const frames = new FrameNodes(tf);
	const used = frames.get("base_link");
	used.add(new THREE.Group());
	const unused = frames.get("odom");

	tf.absoluteTransforms.base_link.translation = { x: 5, y: 0, z: 0 };
	frames.update();
	assert.deepEqual(used.position.toArray(), [5, 0, 0]);
	assert.equal(unused.parent, null);
	assert.notEqual(frames.get("odom"), unused);

	delete tf.absoluteTransforms.base_link;
	frames.update();
	assert.equal(used.visible, false);

	tf.absoluteTransforms.base_link = { translation: { x: 1, y: 1, z: 1 }, rotation: { w: 1, x: 0, y: 0, z: 0 } };
	frames.update();
	assert.equal(used.visible, true);
});
