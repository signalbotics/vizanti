import * as THREE from '../lib/three.module.min.js';

// A single-colour mesh made of loose triangles, used by displays that draw flat shapes
// (arrows, cells, sectors). Drawn without depth writes so list order decides what is on top.
export class FlatMesh {

	constructor(color, opacity = 1) {
		this.material = new THREE.MeshBasicMaterial({
			color,
			opacity,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
		});
		this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
		this.mesh.frustumCulled = false;
		this.mesh.visible = false;
	}

	// positions: Float32Array of triangle vertices. Returns true when there is something to draw.
	setTriangles(positions) {
		this.mesh.geometry.dispose();
		this.mesh.geometry = new THREE.BufferGeometry();
		if (positions.length === 0) {
			this.mesh.visible = false;
			return false;
		}
		this.mesh.geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
		this.mesh.visible = true;
		return true;
	}

	dispose() {
		this.mesh.geometry.dispose();
		this.material.dispose();
	}
}
