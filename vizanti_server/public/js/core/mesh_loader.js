import * as THREE from '../lib/three.module.min.js';
import { meshUrl } from '../geometry/urdf.js';

let loaders = null;

// the loaders are only fetched when something actually shows a mesh
export function getMeshLoaders() {
	loaders ??= Promise.all([
		import('../lib/three_addons/loaders/STLLoader.js'),
		import('../lib/three_addons/loaders/ColladaLoader.js'),
		import('../lib/three_addons/loaders/OBJLoader.js'),
	]).then(([stl, dae, obj]) => ({ stl: new stl.STLLoader(), dae: new dae.ColladaLoader(), obj: new obj.OBJLoader() }));
	return loaders;
}

// Loads a package:// mesh into a scene object.
//   makeMaterial(): material for meshes that bring none of their own (STL, OBJ)
//   keepOwnMaterials: whether a Collada file's own materials are kept
// Rejects when the URI is not servable or the file cannot be loaded.
export async function loadMeshObject(filename, makeMaterial, keepOwnMaterials = true) {
	const source = meshUrl(filename, base_url);
	if (!source)
		throw new Error(`"${filename}" is not a package:// path to an .stl, .dae or .obj file`);

	const loaded = await (await getMeshLoaders())[source.format].loadAsync(source.url);

	let object;
	if (source.format === "stl") {
		if (!loaded.attributes.normal)
			loaded.computeVertexNormals();
		object = new THREE.Mesh(loaded, makeMaterial());
	} else if (source.format === "dae") {
		object = loaded.scene;
		// the loader turns Z-up files to three.js's Y-up; this scene is Z-up like the file
		object.rotation.set(0, 0, 0);
	} else {
		object = loaded;
	}

	object.traverse((child) => {
		if (!child.isMesh)
			return;
		if (source.format === "obj" || (source.format === "dae" && !keepOwnMaterials))
			child.material = makeMaterial();
		for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
			material.userData.alpha ??= material.opacity ?? 1;
			material.side = THREE.DoubleSide;
		}
	});
	return object;
}
