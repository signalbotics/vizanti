// What the MoveIt displays share: the robot's URDF (from the description topic), models of it
// posed from joint values (not TF), each placed where the robot's root link is in the fixed frame,
// as RViz places MoveIt's robot states.
import { parseUrdf } from '@vizanti/geometry/urdf.js';
import { forwardKinematics } from '@vizanti/geometry/kinematics.js';
import { RobotMesh } from '@vizanti/core/robot_mesh.js';

export class MoveItRobot {

	// display: the owning Display; onRobot(robot): a (new) URDF arrived
	constructor(display, onRobot) {
		this.display = display;
		this.onRobot = onRobot;
		this.robot = null;
		this.text = null;
		this.meshes = new Set();
		this.unsubscribe = null;
	}

	listen(topic) {
		this.unsubscribe?.();
		this.unsubscribe = topic ? this.display.ctx.subscribe(topic, "std_msgs/msg/String", 0, (msg) => this.description(msg.data)) : null;
	}

	description(text) {
		if (typeof text !== "string" || text === this.text)
			return;
		let robot;
		try {
			robot = parseUrdf(text);
		} catch (e) {
			this.display.status.error("The robot description could not be read: " + e.message);
			return;
		}
		this.text = text;
		this.robot = robot;
		this.onRobot(robot);
	}

	// a new model of the robot, under the display
	mesh() {
		const mesh = new RobotMesh(this.robot, {
			order: this.display.order,
			onChange: () => this.display.requestRender(),
		});
		this.display.add(mesh.group);
		mesh.setOrder(this.display.order);
		this.meshes.add(mesh);
		return mesh;
	}

	drop(mesh) {
		if (!mesh)
			return;
		this.meshes.delete(mesh);
		mesh.dispose();
	}

	// positions: { [joint]: value }; the model goes to the root link's place in the fixed frame
	pose(mesh, positions) {
		mesh.setPoses(forwardKinematics(this.robot, positions));
		return this.placeRoot(mesh);
	}

	// true when the root link has a transform to the fixed frame
	placeRoot(mesh) {
		const tf = this.display.ctx.tf;
		const root = this.robot?.root;
		let pose = root ? tf.absoluteTransforms[root] : null;
		if (!pose && root === tf.fixed_frame)
			pose = { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
		mesh.group.visible = !!pose;
		if (pose) {
			mesh.group.position.set(pose.translation.x, pose.translation.y, pose.translation.z);
			mesh.group.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
		}
		return !!pose;
	}

	placeAll() {
		let ok = true;
		for (const mesh of this.meshes)
			ok = this.placeRoot(mesh) && ok;
		return ok;
	}

	// the meshes still loading or failed, over all models (for the status line)
	meshReport() {
		const any = [...this.meshes][0];
		return { pending: any?.pendingMeshes ?? 0, failed: any?.failedMeshes ?? [] };
	}

	dispose() {
		this.unsubscribe?.();
		for (const mesh of this.meshes)
			mesh.dispose();
		this.meshes.clear();
	}
}
