import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

const TOPIC_TYPES = ["std_msgs/msg/Bool", "std_msgs/msg/Empty"];
const SERVICE_TYPES = ["std_srvs/srv/Empty", "std_srvs/srv/Trigger", "std_srvs/srv/SetBool"];

// What a press does for each target type.
export const BUTTON_ACTIONS = {
	"std_msgs/msg/Empty": "Publishes an Empty message.",
	"std_msgs/msg/Bool": "Shows the topic's state and publishes the opposite.",
	"std_srvs/srv/Empty": "Calls the Empty service.",
	"std_srvs/srv/Trigger": "Calls the Trigger service and shows its answer.",
	"std_srvs/srv/SetBool": "Calls the SetBool service with the opposite of the last value set.",
};

// the icon for a button state: true / false for the stateful types, else the plain button
export function buttonIcon(type, value) {
	if ((type === "std_msgs/msg/Bool" || type === "std_srvs/srv/SetBool") && typeof value === "boolean")
		return `assets/button_${value}.svg`;
	return "assets/button.svg";
}

// A button in the widget bar: a click publishes to a topic or calls a service (see BUTTON_ACTIONS).
export class ButtonWidget extends WidgetDisplay {

	static type = "button";
	static label = "Button";
	static icon = "assets/button.svg";
	static description = "Publishes Empty / Bool or calls an Empty, Trigger or SetBool service on click";
	static msgTypes = TOPIC_TYPES;
	static properties = {
		text: { type: "string", label: "Text", default: "Text" },
		topic: { type: "topic", label: "Topic or service", serviceTypes: SERVICE_TYPES },
		topic_type: { type: "string", hidden: true, default: "" }, // the target's message or service type
		...WIDGET_PROPERTIES,
	};

	static propsForTopic(topic, type) {
		return { topic, topic_type: type ?? "" };
	}

	// the old template widget saved { state: { topic, text, typedict: { name: type } } }
	static migrateProps(props) {
		const s = props.state;
		if (!s)
			return props;
		const out = {};
		if (typeof s.text === "string")
			out.text = s.text;
		if (typeof s.topic === "string") {
			out.topic = s.topic;
			const type = s.typedict?.[s.topic];
			if (type in BUTTON_ACTIONS)
				out.topic_type = type;
		}
		return out;
	}

	get iconColor() {
		return null;
	}

	get icon() {
		return buttonIcon(this.props.topic_type, this.flash ?? this.value);
	}

	// only a Bool topic is listened to
	get subscribes() {
		return this.props.topic_type === "std_msgs/msg/Bool";
	}

	onCreate() {
		this.value = undefined;
		this.flash = undefined;
		this.result = "";
		if (this.props.topic && !this.props.topic_type)
			this.resolveTarget();
		else
			this.idleStatus();
	}

	onDestroy() {
		clearTimeout(this.flashTimer);
		clearTimeout(this.pressTimer);
	}

	idleStatus() {
		if (!this.props.topic)
			this.status.error("No topic or service chosen.");
		else if (!(this.props.topic_type in BUTTON_ACTIONS))
			this.status.error(`"${this.props.topic}" is not an Empty / Bool topic or an Empty / Trigger / SetBool service.`);
		else if (!this.subscribes)
			this.status.ok();
	}

	// works out whether the chosen name is a topic or a service, and of which type
	async resolveTarget() {
		const name = this.props.topic;
		this.status.warn("Looking up the topic or service type...");
		let type = await this.ctx.resolveType?.(name);
		if (!TOPIC_TYPES.includes(type)) {
			type = null;
			for (const srv of SERVICE_TYPES) {
				const services = (await this.ctx.listServices?.(srv)) ?? [];
				if (services.includes(name)) {
					type = srv;
					break;
				}
			}
		}
		if (!this._alive || this.props.topic !== name)
			return;
		if (!type) {
			this.status.error(`"${name}" was not found as an Empty / Bool topic or an Empty / Trigger / SetBool service.`);
			return;
		}
		this.setProp("topic_type", type);
	}

	onPropertyChange(key) {
		if (key === "topic") {
			this.value = undefined;
			this.result = "";
			if (this.props.topic)
				this.resolveTarget();
			else
				this.idleStatus();
		}
		if (key === "topic_type") {
			this.value = undefined;
			this._resubscribe();
			this.idleStatus();
		}
		this.paintPanel();
		this.refreshIcon();
	}

	onMessage(msg) {
		this.value = !!msg.data;
		this.paintPanel();
		this.refreshIcon();
	}

	onIconClick() {
		this.press();
	}

	async press() {
		const face = this._faces?.find((f) => f.element.isConnected)?.element;
		face?.classList.add("button-press-effect");
		clearTimeout(this.pressTimer);
		this.pressTimer = setTimeout(() => face?.classList.remove("button-press-effect"), 200);

		const { topic, topic_type: type } = this.props;
		if (!topic || !(type in BUTTON_ACTIONS)) {
			this.idleStatus();
			return;
		}
		if (type === "std_msgs/msg/Empty") {
			this.ctx.publish(topic, type, {});
			this.setResult("Published.");
		} else if (type === "std_msgs/msg/Bool") {
			this.ctx.publish(topic, type, { data: !this.value });
			this.setResult(`Published ${!this.value}.`);
		} else {
			const request = type === "std_srvs/srv/SetBool" ? { data: !this.value } : {};
			try {
				const response = await this.ctx.callService(topic, type, request);
				if (type === "std_srvs/srv/Empty") {
					this.status.ok();
					this.setResult("Called.");
					return;
				}
				const message = response.message || (response.success ? "Succeeded." : "Failed.");
				if (response.success)
					this.status.ok(message);
				else
					this.status.error(message);
				if (type === "std_srvs/srv/SetBool" && response.success)
					this.value = !this.value;
				if (type === "std_srvs/srv/Trigger")
					this.flashResult(!!response.success);
				this.setResult(message);
			} catch (e) {
				this.status.error(`Service call failed: ${e.message}`);
				this.setResult(`Failed: ${e.message}`);
			}
		}
	}

	setResult(text) {
		this.result = text;
		this.paintPanel();
		this.refreshIcon();
	}

	// a Trigger's answer shows on the icon for half a second
	flashResult(success) {
		this.flash = success;
		this.refreshIcon();
		clearTimeout(this.flashTimer);
		this.flashTimer = setTimeout(() => {
			this.flash = undefined;
			this.refreshIcon();
		}, 500);
	}

	buildIcon(face) {
		const image = document.createElement("img");
		image.alt = "";
		const label = document.createElement("p");
		label.className = "icon-text";
		face.append(image, label);
		return () => {
			const src = this.icon;
			if (image.getAttribute("src") !== src)
				image.src = src;
			label.textContent = this.props.text;
		};
	}

	buildPanel(container) {
		const list = document.createElement("dl");
		list.className = "readout";
		this.fields = {};
		for (const [key, label] of [["target", "Target"], ["action", "On click"], ["state", "State"], ["result", "Last result"]]) {
			const dt = document.createElement("dt");
			dt.textContent = label;
			const dd = document.createElement("dd");
			list.append(dt, dd);
			this.fields[key] = dd;
		}
		const send = document.createElement("button");
		send.type = "button";
		send.textContent = "Press";
		send.addEventListener("click", () => this.press());
		container.append(list, send);
		this.paintPanel();
	}

	paintPanel() {
		if (!this.fields)
			return;
		const { topic, topic_type: type } = this.props;
		this.fields.target.textContent = topic ? `${topic}${type ? ` (${type})` : ""}` : "–";
		this.fields.action.textContent = BUTTON_ACTIONS[type] ?? "–";
		this.fields.state.textContent = typeof this.value === "boolean" ? String(this.value) : "–";
		this.fields.result.textContent = this.result || "–";
	}
}
