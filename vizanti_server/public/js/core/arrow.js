import * as THREE from '../lib/three.module.min.js';

// A solid arrow from the origin along +x: a cylinder shaft and a cone head.
// The head is shortened when it would be longer than the arrow itself.
export function makeArrow(length, shaftRadius, headRadius, headLength, material) {
	const group = new THREE.Group();
	const head = Math.min(Math.max(headLength, 0), Math.max(length, 0));
	const shaftLength = Math.max(length - head, 0);

	const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftLength, 16).rotateZ(-Math.PI / 2), material);
	shaft.position.x = shaftLength / 2;
	const tip = new THREE.Mesh(new THREE.ConeGeometry(headRadius, head, 16).rotateZ(-Math.PI / 2), material);
	tip.position.x = shaftLength + head / 2;
	group.add(shaft, tip);
	return group;
}

// Turns an object that points along +x so that it points along (x, y, z).
export function aimAlong(object, x, y, z) {
	const direction = new THREE.Vector3(x, y, z);
	if (direction.lengthSq() === 0)
		return;
	object.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
}

export function disposeObject(object) {
	object.traverse((child) => {
		if (child.geometry)
			child.geometry.dispose();
		for (const material of child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : []) {
			if (material.map)
				material.map.dispose();
			material.dispose();
		}
	});
}
