import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

const STATUS = ["Unknown", "Charging", "Discharging", "Not charging", "Full"];
const HEALTH = ["Unknown", "Good", "Overheat", "Dead", "Overvoltage", "Unspecified failure", "Cold",
	"Watchdog timer expired", "Safety timer expired"];
const CHEMISTRY = ["Unknown", "NiMH", "Li-ion", "LiPo", "LiFe", "NiCd", "LiMn"];

const FIELDS = [
	["percentage", "Percentage"],
	["voltage", "Voltage"],
	["cells", "Cell voltages"],
	["current", "Current draw"],
	["charge", "Charge"],
	["status", "Status"],
	["health", "Health"],
	["chemistry", "Type"],
];

// The icon for a charge level (0..1, NaN when unknown) and charging state.
export function batteryIcon(percentage, charging) {
	if (!Number.isFinite(percentage))
		return "assets/battery_unknown.svg";
	const level = percentage <= 0.2 ? 20 : percentage <= 0.4 ? 40 : percentage <= 0.6 ? 60 : percentage <= 0.8 ? 80 : 100;
	return `assets/battery_${level}${charging ? "_charging" : ""}.svg`;
}

// The panel's text for a BatteryState message (null: nothing received yet).
export function batteryReadout(msg) {
	const set = (value) => Number.isFinite(value) && value !== 0; // the message leaves unknowns at 0 or NaN
	const percent = msg && Number.isFinite(msg.percentage) ? `${Math.round(msg.percentage * 100)} %` : "–";
	return {
		percentage: percent,
		voltage: set(msg?.voltage) ? `${msg.voltage.toFixed(2)} V` : "–",
		cells: msg?.cell_voltage?.length ? Array.from(msg.cell_voltage, (v) => `${v.toFixed(2)} V`).join(", ") : "–",
		current: set(msg?.current) ? `${msg.current.toFixed(2)} A` : "–",
		charge: set(msg?.charge) ? `${msg.charge.toFixed(2)} / ${Number.isFinite(msg.capacity) ? msg.capacity.toFixed(2) : "?"} Ah` : "–",
		status: msg ? STATUS[msg.power_supply_status] ?? String(msg.power_supply_status) : "–",
		health: msg ? HEALTH[msg.power_supply_health] ?? String(msg.power_supply_health) : "–",
		chemistry: msg ? CHEMISTRY[msg.power_supply_technology] ?? String(msg.power_supply_technology) : "–",
	};
}

// sensor_msgs/BatteryState: the charge level as the icon, the rest of the message in the panel.
export class BatteryWidget extends WidgetDisplay {

	static type = "battery";
	static label = "Battery";
	static icon = "assets/battery_unknown.svg";
	static description = "sensor_msgs/BatteryState: charge level icon, voltage, current and health";
	static msgTypes = ["sensor_msgs/msg/BatteryState"];
	static properties = {
		topic: { type: "topic", label: "Topic" },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 500, min: 0, max: 10000 },
		...WIDGET_PROPERTIES,
	};

	// the old template widget saved { state: { topic } }
	static migrateProps(props) {
		return props.state ? { ...props.state } : props;
	}

	get iconColor() {
		return null;
	}

	get icon() {
		const msg = this.lastMsg;
		return msg ? batteryIcon(msg.percentage, msg.power_supply_status === 1) : this.constructor.icon;
	}

	onMessage(msg) {
		const readout = batteryReadout(msg);
		this.setInfo({ "Charge": readout.percentage, "Status": readout.status });
		this.paintPanel();
		this.refreshIcon();
	}

	onPropertyChange(key) {
		if (key === "topic") {
			this.setInfo({});
			this.paintPanel();
			this.refreshIcon();
		}
	}

	buildPanel(container) {
		const list = document.createElement("dl");
		list.className = "readout";
		this.fields = {};
		for (const [key, label] of FIELDS) {
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
		const text = batteryReadout(this.lastMsg);
		for (const [key] of FIELDS)
			this.fields[key].textContent = text[key];
	}
}
