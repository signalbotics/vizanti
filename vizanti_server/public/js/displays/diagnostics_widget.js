import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

const LOG_TYPE = "rcl_interfaces/msg/Log";
const DIAG_TYPE = "diagnostic_msgs/msg/DiagnosticArray";

// level -> name, colours, icon and rank (the order the severity filter uses)
export const LOG_LEVELS = {
	10: { name: "DEBUG", colour: "#7f8c8d", bright: "#b0bec5", icon: "default", rank: 0 },
	20: { name: "INFO", colour: "#2e8b57", bright: "#58d68d", icon: "green", rank: 1 },
	30: { name: "WARN", colour: "#c8891a", bright: "#f5b041", icon: "yellow", rank: 2 },
	40: { name: "ERROR", colour: "#c0392b", bright: "#ec7063", icon: "red", rank: 3 },
	50: { name: "FATAL", colour: "#7b1010", bright: "#ff8a80", icon: "red", rank: 4 },
};
export const DIAG_LEVELS = {
	0: { name: "OK", colour: "#2e8b57", bright: "#58d68d", icon: "green", rank: 0 },
	1: { name: "WARN", colour: "#c8891a", bright: "#f5b041", icon: "yellow", rank: 2 },
	2: { name: "ERROR", colour: "#c0392b", bright: "#ec7063", icon: "red", rank: 3 },
	3: { name: "STALE", colour: "#7f8c8d", bright: "#b0bec5", icon: "default", rank: 1 },
};

const MAX_HISTORY = 15;
const MAX_ENTRIES = 200;
const MAX_TEXT = 300;
const REDRAW_MS = 200;

const truncate = (text) => {
	const str = String(text);
	return str.length <= MAX_TEXT ? str : `${str.slice(0, MAX_TEXT)}… [truncated]`;
};

// What the diagnostics panel shows, built from rosout logs (a group per node, its last messages)
// or a DiagnosticArray (a group per status, its key / value entries).
export class DiagnosticsModel {

	constructor(isLog) {
		this.isLog = isLog;
		this.groups = new Map();
	}

	level(level) {
		return (this.isLog ? LOG_LEVELS : DIAG_LEVELS)[level] ?? { name: `L${level}`, colour: "#7f8c8d", bright: "#b0bec5", icon: "default", rank: 0 };
	}

	group(key) {
		let group = this.groups.get(key);
		if (!group) {
			group = { key, level: 0, rank: -1, count: 0, lastSeen: 0, message: "", entries: new Map(), history: [] };
			this.groups.set(key, group);
		}
		return group;
	}

	add(msg, now = Date.now() / 1000) {
		if (this.isLog)
			this.addLog(msg, now);
		else
			this.addDiagnostics(msg, now);
	}

	addLog(msg, now) {
		if (String(msg.name).includes("vizanti"))
			return;
		const group = this.group(msg.name || "(unnamed)");
		group.count++;
		group.lastSeen = now;
		const file = String(msg.file);
		const location = `${file.slice(file.lastIndexOf("/") + 1)}:${msg.function}:${msg.line}`;
		const text = truncate(msg.msg);
		const last = group.history.at(-1);
		if (last && last.text === text) {
			last.count++;
			last.lastSeen = now;
		} else {
			group.history.push({ location, text, level: msg.level, rank: this.level(msg.level).rank, count: 1, lastSeen: now });
			if (group.history.length > MAX_HISTORY)
				group.history.shift();
		}
		// a node's colour is its worst recent message
		group.rank = -1;
		for (const item of group.history) {
			if (item.rank > group.rank) {
				group.rank = item.rank;
				group.level = item.level;
			}
		}
	}

	addDiagnostics(msg, now) {
		for (const status of msg.status ?? []) {
			const info = this.level(status.level);
			const group = this.group(status.name || "(unnamed)");
			group.level = status.level;
			group.rank = info.rank;
			group.count++;
			group.lastSeen = now;
			group.message = status.hardware_id ? `${status.message} [${status.hardware_id}]` : status.message;
			for (const kv of status.values ?? []) {
				let entry = group.entries.get(kv.key);
				if (!entry) {
					entry = { key: kv.key };
					group.entries.set(kv.key, entry);
				}
				Object.assign(entry, { level: status.level, rank: info.rank, value: truncate(kv.value), lastSeen: now });
			}
			// the least recently updated entries go first
			while (group.entries.size > MAX_ENTRIES) {
				let oldest = null;
				for (const entry of group.entries.values()) {
					if (!oldest || entry.lastSeen < oldest.lastSeen)
						oldest = entry;
				}
				group.entries.delete(oldest.key);
			}
		}
	}

	// groups in display order: logs as they came, diagnostics by name
	list() {
		const groups = [...this.groups.values()];
		return this.isLog ? groups : groups.sort((a, b) => a.key.localeCompare(b.key));
	}

	// the icon for the worst group at or above minRank
	worstIcon(minRank = 0) {
		let worst = null;
		for (const group of this.groups.values()) {
			if (group.rank >= minRank && (!worst || group.rank > worst.rank))
				worst = group;
		}
		return worst ? this.level(worst.level).icon : "default";
	}
}

// rosout (rcl_interfaces/Log) or diagnostics (diagnostic_msgs/DiagnosticArray) as a list of
// nodes / statuses, coloured by severity; the icon shows the worst one.
export class DiagnosticsWidget extends WidgetDisplay {

	static type = "diagnostics";
	static label = "Diagnostics";
	static icon = "assets/diagnostics.svg";
	static description = "rosout logs or /diagnostics, grouped and coloured by severity";
	static msgTypes = [LOG_TYPE, DIAG_TYPE];
	static properties = {
		topic: { type: "topic", label: "Topic" },
		topic_type: { type: "string", hidden: true, default: "" },
		min_rank: { type: "int", label: "Minimum severity", default: 0, min: 0, max: 4, hidden: true }, // set in the panel
		throttle: { type: "int", label: "Socket throttle (ms)", default: 0, min: 0, max: 10000, help: "0 keeps every log message; /diagnostics is fine at 500." },
		opened: { type: "array", default: [], hidden: true }, // groups left open
		...WIDGET_PROPERTIES,
	};

	// the old template widget saved { state: { topic, throttle, opened } }
	static migrateProps(props) {
		const s = props.state;
		if (!s)
			return props;
		const out = { topic: typeof s.topic === "string" ? s.topic : "" };
		const throttle = parseInt(s.throttle, 10);
		if (Number.isFinite(throttle))
			out.throttle = throttle;
		if (Array.isArray(s.opened))
			out.opened = s.opened.filter((k) => typeof k === "string");
		return out;
	}

	get iconColor() {
		return null;
	}

	get icon() {
		const name = this.model?.worstIcon(this.props.min_rank) ?? "default";
		return name === "default" ? "assets/diagnostics.svg" : `assets/diagnostics_${name}.svg`;
	}

	onCreate() {
		this.model = new DiagnosticsModel(this.props.topic_type === LOG_TYPE);
		this.dom = new Map();
		this.paused = false;
		this.dirty = true;
		this.redraw = setInterval(() => this.tick(), REDRAW_MS);
	}

	onDestroy() {
		clearInterval(this.redraw);
	}

	onPropertyChange(key) {
		if (key === "topic" || key === "topic_type")
			this.reset();
		if (key === "min_rank")
			this.refreshIcon();
		this.dirty = true;
	}

	reset() {
		this.model = new DiagnosticsModel(this.props.topic_type === LOG_TYPE);
		this.dom = new Map();
		this.list?.replaceChildren();
		this.paintSeverities();
		this.refreshIcon();
		this.dirty = true;
	}

	onMessage(msg) {
		if (this.paused)
			return;
		const before = this.icon;
		this.model.add(msg);
		this.dirty = true;
		if (this.icon !== before)
			this.refreshIcon();
	}

	tick() {
		if (!this.panelElement?.isConnected)
			return;
		if (this.dirty) {
			this.dirty = false;
			this.render();
		} else {
			this.paintAges();
		}
	}

	buildPanel(container) {
		const toolbar = document.createElement("div");
		toolbar.className = "widget_row";
		this.severity = document.createElement("select");
		this.severity.setAttribute("aria-label", "Minimum severity");
		this.severity.addEventListener("change", () => this.setProp("min_rank", parseInt(this.severity.value, 10)));
		const pause = document.createElement("button");
		pause.type = "button";
		pause.textContent = "Pause";
		pause.addEventListener("click", () => {
			this.paused = !this.paused;
			pause.textContent = this.paused ? "Resume" : "Pause";
			this.dirty = true;
		});
		const clear = document.createElement("button");
		clear.type = "button";
		clear.textContent = "Clear";
		clear.addEventListener("click", () => this.reset());
		toolbar.append(this.severity, pause, clear);
		this.summary = document.createElement("p");
		this.summary.className = "comment";
		this.placeholder = document.createElement("p");
		this.list = document.createElement("div");
		this.list.className = "live_data_display diagnostics_display";
		container.append(toolbar, this.summary, this.placeholder, this.list);
		this.paintSeverities();
	}

	paintSeverities() {
		if (!this.severity)
			return;
		const levels = Object.values(this.model.isLog ? LOG_LEVELS : DIAG_LEVELS).sort((a, b) => a.rank - b.rank);
		this.severity.replaceChildren(...levels.map((level) => {
			const option = document.createElement("option");
			option.value = String(level.rank);
			option.textContent = `${level.name} and worse`;
			return option;
		}));
		this.severity.value = String(this.props.min_rank);
	}

	groupDom(group) {
		let dom = this.dom.get(group.key);
		if (dom)
			return dom;
		const root = document.createElement("details");
		root.className = "diagnostics_group";
		const summary = document.createElement("summary");
		const badge = document.createElement("span");
		badge.className = "diagnostics_badge";
		const name = document.createElement("span");
		name.className = "diagnostics_name";
		const sub = document.createElement("span");
		sub.className = "diagnostics_sub";
		const age = document.createElement("span");
		age.className = "diagnostics_age";
		summary.append(badge, name, sub, age);
		const body = document.createElement("div");
		body.className = "diagnostics_entries";
		root.append(summary, body);
		root.open = this.props.opened.includes(group.key);
		root.addEventListener("toggle", () => {
			this.dirty = true;
			if (this.model.groups.size < 2 || root.open === this.props.opened.includes(group.key))
				return;
			const opened = new Set(this.props.opened);
			if (root.open)
				opened.add(group.key);
			else
				opened.delete(group.key);
			this.setProp("opened", [...opened]);
		});
		dom = { root, badge, name, sub, age, body, group };
		this.dom.set(group.key, dom);
		return dom;
	}

	render() {
		const model = this.model;
		const minRank = this.props.min_rank;
		const groups = model.list();
		const solo = groups.length === 1;
		let visible = 0;
		let total = 0;
		groups.forEach((group, i) => {
			total += group.count;
			const dom = this.groupDom(group);
			if (this.list.children[i] !== dom.root)
				this.list.insertBefore(dom.root, this.list.children[i] ?? null);
			const info = model.level(group.level);
			dom.badge.textContent = info.name;
			dom.badge.style.backgroundColor = info.colour;
			dom.name.textContent = group.key;
			dom.sub.textContent = group.message;
			if (solo)
				dom.root.open = true;
			const shown = group.rank >= minRank;
			dom.root.style.display = shown ? "" : "none";
			if (!shown)
				return;
			visible++;
			if (dom.root.open)
				this.renderBody(dom, group, minRank);
		});
		this.placeholder.textContent = model.groups.size === 0 ? "Waiting for data..." : "Nothing matches the current severity.";
		this.placeholder.style.display = visible > 0 ? "none" : "";
		this.summary.textContent = this.paused ? "Paused: incoming messages are dropped." : `${visible} of ${model.groups.size} shown, ${total} updates.`;
		this.paintAges();
	}

	renderBody(dom, group, minRank) {
		const rows = [];
		if (this.model.isLog) {
			let previous = null;
			for (const item of group.history) {
				if (item.rank < minRank)
					continue;
				const row = document.createElement("div");
				row.className = "diagnostics_log_entry";
				if (item.location !== previous) {
					const location = document.createElement("div");
					location.className = "diagnostics_location";
					location.textContent = item.location;
					location.style.color = this.model.level(item.level).bright;
					row.appendChild(location);
				}
				previous = item.location;
				const line = document.createElement("div");
				line.className = "diagnostics_line";
				const gutter = document.createElement("div");
				gutter.className = "diagnostics_gutter";
				const dup = document.createElement("span");
				dup.className = "diagnostics_dup";
				dup.textContent = item.count > 1 ? `${item.count}×` : "";
				gutter.appendChild(dup);
				const text = document.createElement("span");
				text.className = "diagnostics_value";
				text.textContent = item.text;
				line.append(gutter, text);
				row.appendChild(line);
				rows.push(row);
			}
		} else {
			for (const entry of group.entries.values()) {
				if (entry.rank < minRank)
					continue;
				const row = document.createElement("div");
				row.className = "diagnostics_entry";
				const key = document.createElement("span");
				key.className = "diagnostics_key";
				key.textContent = entry.key;
				const value = document.createElement("span");
				value.className = "diagnostics_value";
				value.textContent = entry.value;
				row.append(key, value);
				rows.push(row);
			}
		}
		dom.body.replaceChildren(...rows);
	}

	paintAges() {
		const now = Date.now() / 1000;
		for (const dom of this.dom.values()) {
			if (dom.root.style.display !== "none")
				dom.age.textContent = `${(now - dom.group.lastSeen).toFixed(1)}s`;
		}
	}

	attachPanel(host) {
		super.attachPanel(host);
		this.dirty = true;
	}
}
