import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

const STATUS_POLL_MS = 5000;
const CONFIRM_MS = 4000;
// Vizanti's own consolidated TF is a copy of /tf; recording it doubles the bag for nothing
const SKIPPED = ["/vizanti/tf_consolidated", "/vizanti/tf_static_consolidated"];

// "~/bags/run.bag" recorded on 2026-10-06 14:05 -> "~/bags/2026-10-06-14-05-run.bag"
export function timestampedPath(path, date) {
	const pad = (n) => String(n).padStart(2, "0");
	const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}-${pad(date.getMinutes())}`;
	const parts = path.split("/");
	const name = parts.pop();
	return [...parts, `${stamp}-${name}`].join("/");
}

// topic names grouped by message type, both sorted, without Vizanti's own copies
export function topicsByType(all) {
	const groups = new Map();
	all.topics.forEach((topic, i) => {
		if (SKIPPED.includes(topic))
			return;
		const type = all.types[i];
		if (!groups.has(type))
			groups.set(type, []);
		groups.get(type).push(topic);
	});
	return new Map([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

// Records a bag on the robot (ros2 bag record, run by the Vizanti server).
export class RosbagWidget extends WidgetDisplay {

	static type = "rosbag";
	static label = "Bag Recorder";
	static icon = "assets/rosbag.svg";
	static description = "Record a rosbag of chosen topics on the robot";
	static properties = {
		path: { type: "string", label: "Save to", default: "~/recording.bag", help: "On the robot. The start time is put in front of the file name." },
		topics: { type: "array", label: "Topics", default: [] },
		...WIDGET_PROPERTIES,
	};

	// the old template widget saved { state: { path, topic_list } }
	static migrateProps(props) {
		const s = props.state;
		if (!s)
			return props;
		const out = {};
		if (typeof s.path === "string" && s.path)
			out.path = s.path;
		if (Array.isArray(s.topic_list))
			out.topics = s.topic_list.filter((t) => typeof t === "string");
		return out;
	}

	get iconColor() {
		return null;
	}

	get icon() {
		return this.recording ? "assets/rosbag_active.svg" : "assets/rosbag.svg";
	}

	onCreate() {
		this.recording = false;
		this.status.ok("Idle.");
		this.pollStatus();
		this.poll = setInterval(() => this.pollStatus(), STATUS_POLL_MS);
	}

	onDestroy() {
		clearInterval(this.poll);
		clearTimeout(this.confirmTimer);
	}

	// another browser may have started or stopped a recording
	async pollStatus() {
		if (!this.enabled)
			return;
		try {
			const response = await this.ctx.callService("/vizanti/bag/status", "std_srvs/srv/Trigger", {});
			this.setRecording(!!response.success);
		} catch (e) {
			this.status.warn("The recorder service is not answering.");
		}
	}

	setRecording(recording) {
		if (recording !== this.recording) {
			this.recording = recording;
			this.refreshIcon();
		}
		if (recording)
			this.status.warn("Recording...");
		else
			this.status.ok("Idle.");
		this.paintPanel();
	}

	// the first click asks, the second (within a few seconds) does it
	toggle() {
		if (!this.confirming) {
			this.confirming = true;
			this.paintPanel();
			clearTimeout(this.confirmTimer);
			this.confirmTimer = setTimeout(() => {
				this.confirming = false;
				this.paintPanel();
			}, CONFIRM_MS);
			return;
		}
		this.confirming = false;
		clearTimeout(this.confirmTimer);
		if (this.recording)
			this.call([], false, "");
		else if (this.props.topics.length === 0)
			this.showMessage("Choose at least one topic.");
		else
			this.call(this.props.topics, true, timestampedPath(this.props.path, new Date()));
	}

	async call(topics, start, path) {
		this.showMessage(start ? "Starting..." : "Stopping...");
		try {
			const response = await this.ctx.callService("/vizanti/bag/setup", "vizanti_msgs/srv/RecordRosbag", { topics, start, path });
			this.showMessage(response.message);
		} catch (e) {
			this.showMessage(`The recorder did not answer: ${e.message}`);
		}
		this.pollStatus();
	}

	showMessage(text) {
		this.message = text;
		this.paintPanel();
	}

	setTopics(topics) {
		this.setProp("topics", [...new Set(topics)].sort());
		this.paintChecks();
	}

	buildPanel(container) {
		this.toggleButton = document.createElement("button");
		this.toggleButton.type = "button";
		this.toggleButton.className = "rosbag_toggle";
		this.toggleButton.addEventListener("click", () => this.toggle());
		this.messageLine = document.createElement("p");
		this.messageLine.className = "comment";

		const row = document.createElement("div");
		row.className = "widget_row";
		const all = document.createElement("button");
		all.type = "button";
		all.textContent = "Select all";
		all.addEventListener("click", () => this.setTopics([...this.groups.values()].flat()));
		const none = document.createElement("button");
		none.type = "button";
		none.textContent = "Select none";
		none.addEventListener("click", () => this.setTopics([]));
		const refresh = document.createElement("button");
		refresh.type = "button";
		refresh.textContent = "Refresh";
		refresh.addEventListener("click", () => this.loadTopics());
		row.append(all, none, refresh);

		this.count = document.createElement("p");
		this.list = document.createElement("div");
		this.list.className = "rosbag_topics";
		container.append(this.toggleButton, this.messageLine, row, this.count, this.list);
		this.groups = new Map();
		this.paintPanel();
	}

	attachPanel(host) {
		super.attachPanel(host);
		this.loadTopics();
		this.pollStatus();
	}

	async loadTopics() {
		let all;
		try {
			all = await this.ctx.listAllTopics();
		} catch (e) {
			return;
		}
		this.groups = topicsByType(all);
		// topics chosen earlier that are not published now stay listed
		const known = new Set([...this.groups.values()].flat());
		const missing = this.props.topics.filter((t) => !known.has(t));
		if (missing.length)
			this.groups.set("(not published now)", missing);
		this.list.replaceChildren();
		for (const [type, topics] of this.groups) {
			const details = document.createElement("details");
			const summary = document.createElement("summary");
			summary.textContent = `${type} (${topics.length})`;
			details.appendChild(summary);
			for (const topic of topics) {
				const label = document.createElement("label");
				label.className = "rosbag_topic";
				const box = document.createElement("input");
				box.type = "checkbox";
				box.dataset.topic = topic;
				box.addEventListener("change", () => {
					const chosen = new Set(this.props.topics);
					if (box.checked)
						chosen.add(topic);
					else
						chosen.delete(topic);
					this.setTopics([...chosen]);
				});
				label.append(box, ` ${topic}`);
				details.appendChild(label);
			}
			this.list.appendChild(details);
		}
		this.paintChecks();
	}

	paintChecks() {
		if (!this.list)
			return;
		const chosen = new Set(this.props.topics);
		for (const box of this.list.querySelectorAll("input[type=checkbox]"))
			box.checked = chosen.has(box.dataset.topic);
		// groups with a chosen topic start open
		for (const details of this.list.querySelectorAll("details")) {
			if ([...details.querySelectorAll("input")].some((box) => box.checked))
				details.open = true;
		}
		this.count.textContent = `${chosen.size} topic${chosen.size === 1 ? "" : "s"} chosen.`;
	}

	paintPanel() {
		if (!this.toggleButton)
			return;
		const action = this.recording ? "Stop recording" : "Start recording";
		this.toggleButton.textContent = this.confirming ? `${action}? Click again to confirm` : action;
		this.toggleButton.classList.toggle("recording", this.recording);
		this.messageLine.textContent = this.message ?? (this.recording ? "Recording on the robot." : `Saves to ${this.props.path} (with the start time in front).`);
		this.paintChecks();
	}

	onPropertyChange(key) {
		if (key === "path")
			this.paintPanel();
		if (key === "topics")
			this.paintChecks();
	}
}
