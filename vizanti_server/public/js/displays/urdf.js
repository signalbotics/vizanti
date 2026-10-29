import { Display } from '../core/display.js';
import { parseUrdf } from '../geometry/urdf.js';
import { RobotMesh } from '../core/robot_mesh.js';

// The robot built from its URDF: every link's shapes and meshes, placed at the link's TF frame.
export class UrdfDisplay extends Display {

	static type = "urdf";
	static label = "Robot Model (URDF)";
	static icon = "assets/robotmodel.svg";
	static description = "The robot in 3D, built from its URDF on /robot_description and posed by TF";
	static msgTypes = ["std_msgs/msg/String"];

	static properties = {
		topic: {
			type: "topic", label: "Description topic", default: "/robot_description",
			help: "Published by robot_state_publisher. Each link is drawn at its TF frame, so the joints move with TF.",
		},
		show_visual: { type: "bool", label: "Visual", default: true },
		show_collision: { type: "bool", label: "Collision", default: false },
		opacity: { type: "float", label: "Alpha", default: 1.0, min: 0.05, max: 1, step: 0.05, slider: true },
		tf_prefix: { type: "string", label: "TF prefix", default: "" },
		hidden_links: { type: "object", default: {} },
	};

	get iconColor() {
		return null;
	}

	onCreate() {
		this.mesh = null; // RobotMesh
		this.links = new Map(); // link name -> { group, visual, collision } (the mesh's)
		this.robot = null;
		this.editor = null;
	}

	onMessage(msg) {
		const text = typeof msg.data === "string" ? msg.data : "";
		if (this.robot && text === this.lastText)
			return; // the same description again

		let robot;
		try {
			robot = parseUrdf(text);
		} catch (e) {
			this.status.error("The robot description could not be read: " + e.message);
			return;
		}
		this.lastText = text;
		this.clear();
		this.robot = robot;
		this.mesh = new RobotMesh(robot, {
			order: this.order,
			onChange: () => {
				this.report();
				this.requestRender();
			},
		});
		this.links = this.mesh.links;
		this.add(this.mesh.group);
		this.mesh.setOrder(this.order);
		this.applyVisibility();
		this.applyOpacity();
		this.place();
		this.refreshEditor();
		this.report();
	}

	// moves every link to its TF frame; links with no transform yet are hidden
	place() {
		const tf = this.ctx.tf;
		this.missing = 0;
		for (const [name, entry] of this.links) {
			const frame = this.props.tf_prefix + name;
			let pose = tf.absoluteTransforms[frame];
			if (!pose && frame === tf.fixed_frame)
				pose = { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
			entry.placed = !!pose;
			if (pose) {
				entry.group.position.set(pose.translation.x, pose.translation.y, pose.translation.z);
				entry.group.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
			} else {
				this.missing++;
			}
			entry.group.visible = entry.placed && !this.props.hidden_links[name];
		}
	}

	report() {
		if (!this.robot)
			return;
		const total = this.links.size;
		this.setInfo({
			"Robot": this.robot.name || "(unnamed)",
			"Links": total,
			"Meshes loading": this.mesh?.pendingMeshes ?? 0,
		});
		const failed = this.mesh?.failedMeshes ?? [];
		if (failed.length)
			this.status.error(`${failed.length} mesh(es) could not be loaded, first: ${failed[0]}`);
		else if (this.missing === total && total > 0)
			this.status.warn("No TF for any link of this robot yet. Is robot_state_publisher running, and is the TF prefix right?");
		else if (this.missing > 0)
			this.status.warn(`No TF for ${this.missing} of ${total} links.`);
		else if (this.robot.skipped > 0)
			this.status.warn(`${this.robot.skipped} shape(s) in the description could not be read and are not shown.`);
		else
			this.status.ok();
	}

	applyVisibility() {
		this.mesh?.setVisibility(this.props.show_visual, this.props.show_collision);
	}

	applyOpacity() {
		this.mesh?.setOpacity(this.props.opacity);
	}

	clear() {
		this.mesh?.dispose();
		this.mesh = null;
		this.links = new Map();
		this.robot = null;
	}

	onTfChange() {
		const before = this.missing;
		this.place();
		if (before !== this.missing)
			this.report();
	}

	onFixedFrameChange() {
		this.place();
		this.report();
	}

	onPropertyChange(key) {
		if (key === "topic") {
			this.clear();
			this.lastText = null;
			this.setInfo({});
			this.refreshEditor();
		}
		if (key === "opacity")
			this.applyOpacity();
		if (key === "tf_prefix" || key === "hidden_links") {
			this.place();
			this.report();
		}
		this.applyVisibility();
	}

	onDestroy() {
		this.clear();
	}

	// ---- per-link visibility ----

	refreshEditor() {
		if (!this.editor)
			return;
		if (this.editor.list.isConnected)
			this.editor.render();
		else
			this.editor = null;
	}

	buildCustomEditor(container) {
		const details = document.createElement("details");
		const summary = document.createElement("summary");
		summary.textContent = "Links";
		const list = document.createElement("div");
		details.append(summary, list);
		container.appendChild(details);

		const render = () => {
			list.replaceChildren();
			for (const name of [...this.links.keys()].sort()) {
				const row = document.createElement("div");
				row.classList.add("tf_label");
				const checkbox = document.createElement("input");
				checkbox.type = "checkbox";
				checkbox.checked = !this.props.hidden_links[name];
				checkbox.addEventListener("change", () => {
					const hidden = { ...this.props.hidden_links };
					if (checkbox.checked)
						delete hidden[name];
					else
						hidden[name] = true;
					this.setProp("hidden_links", hidden);
				});
				const label = document.createElement("label");
				label.textContent = " " + name;
				row.append(checkbox, label);
				list.appendChild(row);
			}
		};
		render();
		this.editor = { list, render };
	}
}
