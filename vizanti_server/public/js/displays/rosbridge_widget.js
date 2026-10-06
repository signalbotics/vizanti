import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';
import { rosbridge } from '../modules/rosbridge.js';

const ICONS = {
	connected: "assets/rosbridge_connected.svg",
	reconnecting: "assets/rosbridge_reconnect.svg",
	disconnected: "assets/rosbridge_disconnected.svg",
};

// The icons are needed most when the connection is in trouble, so load them up front.
const preloaded = {};
for (const [key, path] of Object.entries(ICONS)) {
	fetch(path).then((r) => r.blob()).then((blob) => { preloaded[key] = URL.createObjectURL(blob); }).catch(() => {});
}

// The rosbridge connection: its state as the icon; address, compression and a reload in the panel.
export class RosbridgeWidget extends WidgetDisplay {

	static type = "rosbridge";
	static label = "Rosbridge";
	static icon = ICONS.disconnected;
	static description = "The connection to the robot (rosbridge): state, address and a reload";
	static properties = { ...WIDGET_PROPERTIES };

	get iconColor() {
		return null;
	}

	get icon() {
		return preloaded[this.state] ?? ICONS[this.state ?? "disconnected"];
	}

	onCreate() {
		this.state = "disconnected";
		this.onChange = () => this.update();
		window.addEventListener("rosbridge_change", this.onChange);
		this.update();
	}

	update() {
		const text = rosbridge.status;
		if (text === "Reconnecting...") {
			this.state = "reconnecting";
			this.status.error(text);
		} else if (text === "Connecting...") {
			this.state = "connected";
			this.status.warn(text);
		} else if (rosbridge.connected) {
			this.state = "connected";
			this.status.ok();
		} else {
			this.state = "disconnected";
			this.status.error(text || "Not connected.");
		}
		this.paintPanel();
		this.refreshIcon();
	}

	buildPanel(container) {
		const list = document.createElement("dl");
		list.className = "readout";
		this.fields = {};
		for (const [key, label] of [["state", "State"], ["url", "Bridge URL"], ["compression", "Compression"]]) {
			const dt = document.createElement("dt");
			dt.textContent = label;
			const dd = document.createElement("dd");
			list.append(dt, dd);
			this.fields[key] = dd;
		}
		const note = document.createElement("p");
		note.className = "comment";
		note.textContent = `A WS (not WSS) rosbridge is expected on port ${rosbridge.port}.`;
		const reload = document.createElement("button");
		reload.type = "button";
		reload.textContent = "Force reload";
		reload.title = "Reload the page and connect again";
		reload.addEventListener("click", () => window.location.reload());
		container.append(list, note, reload);
		this.paintPanel();
	}

	paintPanel() {
		if (!this.fields)
			return;
		this.fields.state.textContent = rosbridge.status;
		this.fields.url.textContent = `ws://${rosbridge.url}:${rosbridge.port}`;
		this.fields.compression.textContent = rosbridge.compression;
	}

	onDestroy() {
		window.removeEventListener("rosbridge_change", this.onChange);
	}
}
