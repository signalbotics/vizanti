import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

// "hot" above the high threshold, "cold" below the low one, else "warm".
export function temperatureBand(celsius, low, high) {
	if (!Number.isFinite(celsius))
		return "unknown";
	if (celsius > high)
		return "hot";
	if (celsius < low)
		return "cold";
	return "warm";
}

// sensor_msgs/Temperature: a thermometer icon that turns hot or cold past two thresholds,
// and the reading in the panel.
export class TemperatureWidget extends WidgetDisplay {

	static type = "temperature";
	static label = "Temperature";
	static icon = "assets/temp_unknown.svg";
	static description = "sensor_msgs/Temperature: hot / cold icon by threshold, and the reading";
	static msgTypes = ["sensor_msgs/msg/Temperature"];
	static properties = {
		topic: { type: "topic", label: "Topic" },
		high: { type: "float", label: "High (°C)", default: 60, min: -272, max: 3000, step: 0.1, help: "Above this the icon shows hot." },
		low: { type: "float", label: "Low (°C)", default: 20, min: -272, max: 3000, step: 0.1, help: "Below this the icon shows cold." },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 500, min: 0, max: 10000 },
		...WIDGET_PROPERTIES,
	};

	// the old template widget saved { state: { topic, high, low } }, the numbers as typed text
	static migrateProps(props) {
		if (!props.state)
			return props;
		const out = { topic: props.state.topic ?? "" };
		for (const key of ["high", "low"]) {
			const value = parseFloat(props.state[key]);
			if (Number.isFinite(value))
				out[key] = value;
		}
		return out;
	}

	get iconColor() {
		return null;
	}

	get icon() {
		const msg = this.lastMsg;
		return `assets/temp_${temperatureBand(msg?.temperature, this.props.low, this.props.high)}.svg`;
	}

	onMessage(msg) {
		this.setInfo({ "Temperature": `${msg.temperature.toFixed(2)} °C` });
		this.paintPanel();
		this.refreshIcon();
	}

	onPropertyChange(key) {
		if (key === "topic")
			this.setInfo({});
		this.paintPanel();
		this.refreshIcon();
	}

	buildPanel(container) {
		const list = document.createElement("dl");
		list.className = "readout";
		this.fields = {};
		for (const [key, label] of [["temperature", "Temperature"], ["variance", "Variance"], ["frame", "TF frame"]]) {
			const dt = document.createElement("dt");
			dt.textContent = label;
			const dd = document.createElement("dd");
			list.append(dt, dd);
			this.fields[key] = dd;
		}
		container.appendChild(list);
		this.paintPanel();
	}

	paintPanel() {
		if (!this.fields)
			return;
		const msg = this.lastMsg;
		this.fields.temperature.textContent = msg ? `${msg.temperature.toFixed(2)} °C` : "–";
		this.fields.variance.textContent = msg ? msg.variance.toFixed(2) : "–";
		this.fields.frame.textContent = msg ? msg.header.frame_id || "–" : "–";
	}
}
