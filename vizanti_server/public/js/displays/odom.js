import { Display } from '../core/display.js';
import { FlatMesh } from '../core/flat_mesh.js';
import { pathSegments, pathLength, formatDistance } from '../geometry/shapes.js';
import { eulerFromQuat } from '../geometry/pose.js';
import { appendSample, arrowMarks, samplesToCsv, parseLegacyTarget } from '../geometry/track.js';
import { IndexedDatabase } from '../modules/database.js';

// Records where a TF frame or an odometry topic has been and draws the track.
export class OdomDisplay extends Display {

	static type = "odom";
	static label = "Pose Tracker";
	static icon = "assets/odom.svg";
	static description = "Track a TF link or [nav_msgs/Odometry] data over time.";
	static msgTypes = ["nav_msgs/msg/Odometry"];

	static properties = {
		mode: {
			type: "enum", label: "Track", default: "tf",
			options: [{ value: "tf", label: "TF frame" }, { value: "topic", label: "Odometry topic" }],
		},
		frame: { type: "frame", label: "Frame", noDefault: true },
		topic: { type: "topic", label: "Odometry topic" },
		color: { type: "color", label: "Colour", default: "#c43b00" },
		history: { type: "int", label: "History (N)", default: 2000, min: 2, max: 50000 },
		throttle: { type: "int", label: "Sample delay (ms)", default: 500, min: 0, max: 10000 },
		draw_path: { type: "bool", label: "Draw path", default: true },
		draw_arrows: { type: "bool", label: "Draw arrows", default: true },
		save_history: {
			type: "bool", label: "Save history", default: true,
			help: "Recorded data will reset upon page reload if saving is disabled.",
		},
	};

	static propsForTopic(topic) {
		return { mode: "topic", topic };
	}

	static fromLegacy(state) {
		return { ...state, ...parseLegacyTarget(state.topic) };
	}

	onCreate() {
		this.line = this.add(this.ctx.scene.makeLines({ color: this.props.color, linewidth: 3, opacity: 0.6 }));
		this.arrows = new FlatMesh(this.props.color);
		this.add(this.arrows.mesh);
		this.samples = [];
		this.lastSample = 0;
		this.lastStore = 0;
		this.db = null;
		this.load();
	}

	get dbKey() {
		return "odom_pose_track_" + this.id;
	}

	async load() {
		try {
			const db = new IndexedDatabase("odom_history");
			await db.openDB();
			this.db = db;
			if (!this.props.save_history)
				return;
			const stored = await db.getObject(this.dbKey);
			if (stored instanceof Float32Array && stored.length % 4 === 0) {
				const saved = [];
				for (let i = 0; i < stored.length; i += 4)
					saved.push({ x: stored[i], y: stored[i + 1], z: stored[i + 2], yaw: stored[i + 3] });
				this.samples = [...saved, ...this.samples].slice(-this.props.history);
				this.rebuild();
			}
		} catch (e) {
			// storage blocked: the track simply is not kept across reloads
		}
	}

	store() {
		if (!this.db)
			return;
		let packed = null;
		if (this.props.save_history) {
			packed = new Float32Array(this.samples.length * 4);
			this.samples.forEach((s, i) => packed.set([s.x, s.y, s.z, s.yaw], i * 4));
		}
		this.db.setObject(this.dbKey, packed).catch(() => {});
	}

	// only the odometry mode uses a subscription
	_resubscribe() {
		if (this.props.mode === "topic") {
			super._resubscribe();
			return;
		}
		if (this._unsubscribe) {
			this._unsubscribe();
			this._unsubscribe = null;
		}
		if (this.props.frame === "")
			this.status.warn("No target.");
	}

	record(translation, rotation) {
		const pose = { x: translation.x, y: translation.y, z: translation.z, yaw: eulerFromQuat(rotation).yaw };
		if (!appendSample(this.samples, pose, this.props.history))
			return false;
		this.rebuild();
		const now = Date.now();
		if (now - this.lastStore > 3000) {
			this.lastStore = now;
			this.store();
		}
		return true;
	}

	rebuild() {
		const scene = this.ctx.scene;
		const hasLine = scene.setLinePositions(this.line, pathSegments(this.samples));
		this.line.visible = hasLine && this.props.draw_path;

		// arrows keep their size on screen: 15 px long, at least 20 px apart
		const ppm = scene.pixelsPerMeter();
		if (ppm > 0 && this.props.draw_arrows)
			this.arrows.setTriangles(arrowMarks(this.samples, 20 / ppm, 15 / ppm, 5 / ppm));
		else
			this.arrows.setTriangles(new Float32Array(0));

		this.setInfo({ "Points": this.samples.length, "Distance": formatDistance(pathLength(this.samples)) });
		if (this.samples.length < 2 && this.status.level === "ok")
			this.status.warn("No data yet!");
	}

	onMessage(msg) {
		const tf = this.ctx.tf;
		let frame = msg.header.frame_id;
		if (frame === "") {
			this.status.warn("Transform frame is an empty string, falling back to fixed frame. Fix your publisher ;)");
			frame = tf.fixed_frame;
		}
		if (!tf.absoluteTransforms[frame] && frame !== tf.fixed_frame) {
			this.status.error(`Required transform frame "${frame}" not found.`);
			return;
		}
		const pose = tf.transformPose(frame, tf.fixed_frame, msg.pose.pose.position, msg.pose.pose.orientation);
		this.record(pose.translation, pose.rotation);
	}

	onTfChange() {
		if (this.props.mode !== "tf" || this.props.frame === "")
			return;
		const now = Date.now();
		if (now - this.lastSample < this.props.throttle)
			return;
		const pose = this.ctx.tf.absoluteTransforms[this.props.frame];
		if (!pose) {
			this.status.error(`Required transform frame "${this.props.frame}" not found.`);
			return;
		}
		this.lastSample = now;
		this.record(pose.translation, pose.rotation);
		this.status.ok();
	}

	// the track is recorded in the fixed frame, so it cannot survive a change of fixed frame
	onFixedFrameChange() {
		this.clearHistory();
	}

	onCameraChange() {
		this.rebuild();
	}

	clearHistory() {
		this.samples = [];
		this.store();
		this.rebuild();
	}

	onPropertyChange(key, value) {
		if (key === "color") {
			this.line.material.color.set(value);
			this.arrows.material.color.set(value);
		}
		if (key === "mode" || key === "frame" || key === "topic") {
			this.samples = [];
			this._resubscribe();
		}
		if (key === "history") {
			while (this.samples.length > value)
				this.samples.shift();
		}
		if (key === "save_history")
			this.store();
		this.rebuild();
	}

	onDestroy() {
		this.ctx.scene.disposeLines(this.line);
		this.arrows.dispose();
		if (this.db)
			this.db.setObject(this.dbKey, null).catch(() => {});
	}

	buildCustomEditor(container) {
		const download = document.createElement("button");
		download.textContent = "Download as CSV";
		download.addEventListener("click", () => {
			if (this.samples.length === 0) {
				this.status.warn("No poses to export.");
				return;
			}
			const target = this.props.mode === "tf" ? this.props.frame : this.props.topic;
			const date = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
			const name = `${target}_in_${this.ctx.tf.fixed_frame}_`.replace(/[^\w\d_-]/g, "_") + date;
			const url = URL.createObjectURL(new Blob([samplesToCsv(this.samples)], { type: "text/csv;charset=utf-8;" }));
			const link = document.createElement("a");
			link.href = url;
			link.download = name + ".csv";
			link.click();
			URL.revokeObjectURL(url);
		});

		const note = document.createElement("p");
		note.className = "comment";
		note.textContent = "Export pose data as x, y, yaw for analysis, or to import as a waypoint mission.";

		const clear = document.createElement("button");
		clear.textContent = "Clear history";
		clear.style.backgroundColor = "rgb(104, 78, 31)";
		clear.addEventListener("click", () => this.clearHistory());

		container.append(download, note, clear);
	}
}
