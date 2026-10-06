import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

const MAX_STRING = 200;
const MAX_ARRAY = 50;
const MAX_LINES = 2000;
const NODES_REFRESH_MS = 5000;

// A message as indented lines ({ depth, text }), like `ros2 topic echo`, with long strings and
// arrays cut short so a point cloud does not freeze the page.
export function echoLines(msg, { maxString = MAX_STRING, maxArray = MAX_ARRAY, maxLines = MAX_LINES } = {}) {
	const lines = [];
	const cut = (value) => {
		const text = String(value);
		return text.length > maxString ? `${text.slice(0, maxString)}… [${text.length} characters]` : text;
	};
	const walk = (key, value, depth) => {
		if (lines.length >= maxLines)
			return;
		const prefix = key === null ? "" : `${key}: `;
		if (ArrayBuffer.isView(value) || Array.isArray(value)) {
			const kind = Array.isArray(value) ? "array" : value.constructor.name;
			lines.push({ depth, text: `${prefix}${kind}(${value.length})` });
			const shown = Math.min(value.length, maxArray);
			for (let i = 0; i < shown; i++)
				walk(`[${i}]`, value[i], depth + 1);
			if (value.length > shown)
				lines.push({ depth: depth + 1, text: `… ${value.length - shown} more` });
		} else if (value !== null && typeof value === "object") {
			if (key !== null)
				lines.push({ depth, text: `${key}:` });
			for (const [k, v] of Object.entries(value))
				walk(k, v, key === null ? depth : depth + 1);
		} else {
			lines.push({ depth, text: `${prefix}${typeof value === "string" ? cut(value) : String(value)}` });
		}
	};
	walk(null, msg, 0);
	if (lines.length >= maxLines)
		lines.push({ depth: 0, text: `… (cut at ${maxLines} lines)` });
	return lines;
}

// Echoes any topic, with the nodes publishing and subscribing to it.
export class InspectorWidget extends WidgetDisplay {

	static type = "inspector";
	static label = "Topic Inspector";
	static icon = "assets/inspector.svg";
	static description = "Echo any topic as text, with its publishers and subscribers";
	static properties = {
		topic: { type: "topic", label: "Topic", anyType: true },
		topic_type: { type: "string", hidden: true, default: "" },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 500, min: 0, max: 10000 },
		...WIDGET_PROPERTIES,
	};

	// the old template widget saved { state: { topic, throttle } }
	static migrateProps(props) {
		const s = props.state;
		if (!s)
			return props;
		const out = { topic: typeof s.topic === "string" ? s.topic : "" };
		const throttle = parseInt(s.throttle, 10);
		if (Number.isFinite(throttle))
			out.throttle = throttle;
		return out;
	}

	get iconColor() {
		return null;
	}

	// its type is looked up first
	get subscribes() {
		return this.props.topic_type !== "";
	}

	get topicType() {
		return this.props.topic_type;
	}

	onCreate() {
		this.nodes = null; // { publishers, subscribers }
		this.nodesTime = 0;
		this.lookup();
	}

	onPropertyChange(key) {
		if (key === "topic") {
			this.nodes = null;
			this.nodesTime = 0;
			this.lookup();
		}
		if (key === "topic_type")
			this._resubscribe();
		this.paintPanel();
	}

	// the topic's type, from rosapi; tried again while nothing publishes it
	async lookup() {
		clearTimeout(this.lookupTimer);
		const topic = this.props.topic;
		if (!topic) {
			this.status.error("No topic chosen.");
			return;
		}
		if (this.props.topic_type)
			return;
		this.status.warn("Looking up the topic type...");
		const type = await this.ctx.resolveType(topic);
		if (!this._alive || this.props.topic !== topic)
			return;
		if (!type) {
			this.status.warn(`Topic "${topic}" is not being published yet. Waiting...`);
			this.lookupTimer = setTimeout(() => this.lookup(), 3000);
			return;
		}
		this.setProp("topic_type", type);
	}

	onMessage() {
		if (performance.now() - this.nodesTime > NODES_REFRESH_MS)
			this.refreshNodes();
		this.paintPanel();
	}

	async refreshNodes() {
		this.nodesTime = performance.now();
		const topic = this.props.topic;
		try {
			const nodes = await this.ctx.topicInfo(topic);
			if (this._alive && this.props.topic === topic) {
				this.nodes = nodes;
				this.paintPanel();
			}
		} catch (e) {
			this.nodes = null;
		}
	}

	onDestroy() {
		clearTimeout(this.lookupTimer);
	}

	buildPanel(container) {
		const list = document.createElement("dl");
		list.className = "readout";
		this.fields = {};
		for (const [key, label] of [["topic", "Topic"], ["type", "Type"], ["publishers", "Publishers"], ["subscribers", "Subscribers"]]) {
			const dt = document.createElement("dt");
			dt.textContent = label;
			const dd = document.createElement("dd");
			list.append(dt, dd);
			this.fields[key] = dd;
		}
		const heading = document.createElement("h4");
		heading.textContent = "Echo";
		this.echo = document.createElement("pre");
		this.echo.className = "inspector_echo";
		container.append(list, heading, this.echo);
		this.paintPanel();
	}

	paintPanel() {
		if (!this.fields || !this.panelElement?.isConnected)
			return; // painted when shown
		const f = this.fields;
		f.topic.textContent = this.props.topic || "–";
		f.type.textContent = this.props.topic_type || "–";
		f.publishers.textContent = this.nodes?.publishers?.join(", ") || "–";
		f.subscribers.textContent = this.nodes?.subscribers?.join(", ") || "–";
		this.echo.textContent = this.lastMsg
			? echoLines(this.lastMsg).map(({ depth, text }) => "  ".repeat(depth) + text).join("\n")
			: "Waiting for data...";
	}

	attachPanel(host) {
		super.attachPanel(host);
		this.paintPanel();
	}
}
