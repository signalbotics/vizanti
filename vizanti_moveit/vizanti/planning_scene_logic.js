// MoveIt's PlanningScene display without the page: the world's collision objects, their colours,
// the attached objects and the robot state, kept up to date from moveit_msgs/PlanningScene
// messages (full scenes and diffs, as planning_scene::PlanningScene::usePlanningSceneMsg). Pure.
import { applyRobotState } from './moveit_state_logic.js';

// moveit_msgs/CollisionObject operations
export const OPERATION = { ADD: 0, REMOVE: 1, APPEND: 2, MOVE: 3 };

export function emptyScene() {
	return { name: "", objects: new Map(), colors: new Map(), attached: new Map(), positions: {} };
}

// the shapes of a collision object, each with its pose in the object's frame:
// [{ kind: "primitive" | "mesh" | "plane", shape, pose }]
function shapesOf(object) {
	const shapes = [];
	(object.primitives ?? []).forEach((shape, i) => shapes.push({ kind: "primitive", shape, pose: object.primitive_poses?.[i] }));
	(object.meshes ?? []).forEach((shape, i) => shapes.push({ kind: "mesh", shape, pose: object.mesh_poses?.[i] }));
	(object.planes ?? []).forEach((shape, i) => shapes.push({ kind: "plane", shape, pose: object.plane_poses?.[i] }));
	return shapes;
}

// one CollisionObject applied to a map of objects (id -> { id, frame, pose, shapes })
export function applyCollisionObject(objects, object) {
	const id = object?.id;
	if (!id && object?.operation !== OPERATION.REMOVE)
		return;
	switch (object.operation ?? OPERATION.ADD) {
		case OPERATION.ADD:
			objects.set(id, { id, frame: object.header?.frame_id ?? "", pose: object.pose, shapes: shapesOf(object) });
			break;
		case OPERATION.REMOVE:
			if (id)
				objects.delete(id);
			else
				objects.clear(); // an empty id removes them all
			break;
		case OPERATION.APPEND: {
			const current = objects.get(id);
			if (current)
				current.shapes.push(...shapesOf(object));
			else
				objects.set(id, { id, frame: object.header?.frame_id ?? "", pose: object.pose, shapes: shapesOf(object) });
			break;
		}
		case OPERATION.MOVE: {
			const current = objects.get(id);
			if (current) {
				current.pose = object.pose;
				if (object.header?.frame_id)
					current.frame = object.header.frame_id;
			}
			break;
		}
	}
}

// a moveit_msgs/PlanningScene applied to a scene (returned new; the input is not changed)
export function applyPlanningScene(robot, scene, msg) {
	const diff = !!msg?.is_diff;
	const next = diff
		? { name: scene.name, objects: new Map([...scene.objects].map(([k, v]) => [k, { ...v, shapes: [...v.shapes] }])), colors: new Map(scene.colors), attached: new Map(scene.attached), positions: { ...scene.positions } }
		: emptyScene();
	if (msg?.name || !diff)
		next.name = msg?.name ?? "";
	for (const object of msg?.world?.collision_objects ?? [])
		applyCollisionObject(next.objects, object);
	for (const color of msg?.object_colors ?? [])
		next.colors.set(color.id, [color.color?.r ?? 0, color.color?.g ?? 0, color.color?.b ?? 0, color.color?.a ?? 1]);
	const state = msg?.robot_state;
	if (robot && state) {
		const robotDiff = diff || state.is_diff;
		next.positions = applyRobotState(robot, robotDiff ? next.positions : {}, { ...state, is_diff: robotDiff });
		if (!robotDiff)
			next.attached = new Map();
		for (const attached of state.attached_collision_objects ?? []) {
			const id = attached.object?.id;
			const objects = new Map(next.attached.has(id) ? [[id, next.attached.get(id)]] : []);
			applyCollisionObject(objects, attached.object);
			const object = objects.get(id);
			if (object)
				next.attached.set(object.id, { ...object, link: attached.link_name });
			else
				next.attached.delete(id);
		}
	}
	return next;
}

// shape_msgs/SolidPrimitive -> what to draw: { type: "box" | "sphere" | "cylinder" | "cone", ... }
const PRIMITIVE = { 1: "box", 2: "sphere", 3: "cylinder", 4: "cone" };
export function primitiveShape(primitive) {
	const type = PRIMITIVE[primitive?.type];
	const d = primitive?.dimensions ?? [];
	if (type === "box" && d.length >= 3)
		return { type, size: [d[0], d[1], d[2]] };
	if (type === "sphere" && d.length >= 1)
		return { type, radius: d[0] };
	if ((type === "cylinder" || type === "cone") && d.length >= 2)
		return { type, height: d[0], radius: d[1] }; // SolidPrimitive: [HEIGHT, RADIUS]
	return null;
}
