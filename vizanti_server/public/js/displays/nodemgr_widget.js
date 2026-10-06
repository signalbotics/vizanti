import { WidgetDisplay, WIDGET_PROPERTIES } from '../core/widget.js';

// lifecycle_msgs/State ids: name and colour
export const LIFECYCLE_STATES = {
	0: ["Unknown", "lightgray"],
	1: ["Unconfigured", "#c296d6"],
	2: ["Inactive", "#9995c9"],
	3: ["Active", "#5fd980"],
	4: ["Finalized", "#5997ba"],
	10: ["Configuring", "#f8ff30"],
	11: ["Cleaning up", "#ffcf30"],
	12: ["Shutting down", "#ffa530"],
	13: ["Activating", "#7be1e3"],
	14: ["Deactivating", "#e67f5a"],
	15: ["Error processing", "#cc4747"],
};

const CONFIRM_MS = 4000;
const SLOW_MS = 60000; // listing packages and ros2 doctor can take a while

// the command the server runs for a package and executable: launch files go to ros2 launch
export function nodeCommand(pkg, executable, kind = executable.includes("launch") ? "launch" : "run") {
	return `ros2 ${kind} ${pkg} ${executable}`;
}

// ros2 doctor colours its report with terminal escapes
export function stripEscapes(text) {
	return String(text).replace(/\x1B\[[0-9;]*m/g, "");
}

// A button that asks once ("…? Click again") before it acts.
function confirmButton(label, action, className = "") {
	const button = document.createElement("button");
	button.type = "button";
	button.className = className;
	button.textContent = label;
	let timer = null;
	button.addEventListener("click", () => {
		if (!timer) {
			button.textContent = `${label}? Click again to confirm`;
			timer = setTimeout(() => {
				timer = null;
				button.textContent = label;
			}, CONFIRM_MS);
			return;
		}
		clearTimeout(timer);
		timer = null;
		button.textContent = label;
		action();
	});
	return button;
}

// Start, inspect and kill nodes on the robot, and run ros2 doctor (through the Vizanti server).
export class NodeManagerWidget extends WidgetDisplay {

	static type = "nodemgr";
	static label = "Node Manager";
	static icon = "assets/nodemgr.svg";
	static description = "Start, inspect and kill nodes on the robot; lifecycle states; ros2 doctor";
	static properties = { ...WIDGET_PROPERTIES };

	get iconColor() {
		return null;
	}

	onCreate() {
		this.status.ok();
	}

	call(name, type, request = {}, timeoutMs) {
		return this.ctx.callService(name, type, request, timeoutMs);
	}

	buildPanel(container) {
		// ---- start a node ----
		const startHeading = document.createElement("h4");
		startHeading.textContent = "Start a node";
		const row = document.createElement("div");
		row.className = "widget_row";
		this.kind = document.createElement("select");
		this.kind.setAttribute("aria-label", "Command");
		for (const kind of ["run", "launch"]) {
			const option = document.createElement("option");
			option.value = kind;
			option.textContent = `ros2 ${kind}`;
			this.kind.appendChild(option);
		}
		this.pkg = document.createElement("input");
		this.pkg.placeholder = "package";
		this.pkg.setAttribute("aria-label", "Package");
		this.pkgList = document.createElement("datalist");
		this.pkgList.id = `${this.id}_packages`;
		this.pkg.setAttribute("list", this.pkgList.id);
		this.exe = document.createElement("select");
		this.exe.setAttribute("aria-label", "Executable or launch file");
		this.pkg.addEventListener("change", () => this.loadExecutables());
		this.exe.addEventListener("change", () => {
			this.kind.value = this.exe.value.includes("launch") ? "launch" : "run";
		});
		row.append(this.kind, this.pkg, this.pkgList, this.exe);
		const start = confirmButton("Start", () => this.start());
		this.startResult = document.createElement("p");
		this.startResult.className = "comment";
		this.startResult.textContent = "Executable detection is experimental: some may be missing or extra.";

		// ---- running nodes ----
		const nodesHeading = document.createElement("h4");
		nodesHeading.textContent = "Running nodes";
		const refresh = document.createElement("button");
		refresh.type = "button";
		refresh.textContent = "Refresh";
		refresh.addEventListener("click", () => this.loadNodes());
		this.nodes = document.createElement("div");
		this.nodes.className = "nodemgr_nodes";

		// ---- doctor ----
		const doctorHeading = document.createElement("h4");
		doctorHeading.textContent = "Diagnostics";
		const doctor = document.createElement("button");
		doctor.type = "button";
		doctor.textContent = "Run ros2 doctor";
		this.doctorOutput = document.createElement("pre");
		this.doctorOutput.className = "inspector_echo";
		this.doctorOutput.hidden = true;
		doctor.addEventListener("click", () => this.runDoctor());

		container.append(startHeading, row, start, this.startResult, nodesHeading, refresh, this.nodes, doctorHeading, doctor, this.doctorOutput);
	}

	attachPanel(host) {
		super.attachPanel(host);
		this.loadNodes();
		if (!this.packagesLoaded)
			this.loadPackages();
	}

	async loadPackages() {
		try {
			const { packages } = await this.call("/vizanti/list_packages", "vizanti_msgs/srv/ListPackages", {}, SLOW_MS);
			this.packages = packages;
			this.pkgList.replaceChildren(...packages.map((name) => {
				const option = document.createElement("option");
				option.value = name;
				return option;
			}));
			this.packagesLoaded = true;
		} catch (e) {
			this.startResult.textContent = `The package list did not arrive: ${e.message}`;
		}
	}

	async loadExecutables() {
		const pkg = this.pkg.value.trim();
		this.exe.replaceChildren();
		if (!this.packages?.includes(pkg))
			return;
		try {
			const { executables } = await this.call("/vizanti/list_executables", "vizanti_msgs/srv/ListExecutables", { package: pkg }, SLOW_MS);
			this.exe.replaceChildren(...executables.map((name) => {
				const option = document.createElement("option");
				option.value = name;
				option.textContent = name;
				return option;
			}));
			this.kind.value = this.exe.value.includes("launch") ? "launch" : "run";
		} catch (e) {
			this.startResult.textContent = `The executables did not arrive: ${e.message}`;
		}
	}

	async start() {
		const pkg = this.pkg.value.trim();
		const exe = this.exe.value;
		if (!pkg || !exe) {
			this.startResult.textContent = "Choose a package and an executable.";
			return;
		}
		const command = nodeCommand(pkg, exe, this.kind.value);
		this.startResult.textContent = `Starting: ${command}`;
		try {
			const response = await this.call("/vizanti/node/start", "vizanti_msgs/srv/ManageNode", { node: command }, SLOW_MS);
			this.startResult.textContent = response.message || (response.success ? "Started." : "Failed.");
		} catch (e) {
			this.startResult.textContent = `Failed: ${e.message}`;
		}
		setTimeout(() => this.loadNodes(), 1500);
	}

	async loadNodes() {
		let names;
		try {
			names = (await this.ctx.listNodes()).filter((name) => !name.includes("vizanti")).sort();
		} catch (e) {
			this.status.error("The node list did not arrive.");
			return;
		}
		let lifecycle = {};
		try {
			const result = await this.call("/vizanti/list_lifecycle_nodes", "vizanti_msgs/srv/ListLifecycles", {}, SLOW_MS);
			result.nodes.forEach((name, i) => { lifecycle[name] = result.states[i]; });
		} catch (e) {
			lifecycle = {};
		}
		this.status.ok(`${names.length} nodes.`);
		const open = new Set([...this.nodes.querySelectorAll("details[open]")].map((d) => d.dataset.node));
		this.nodes.replaceChildren(...names.map((name) => this.nodeRow(name, lifecycle[name], open.has(name))));
	}

	nodeRow(name, state, open) {
		const details = document.createElement("details");
		details.className = "nodemgr_node";
		details.dataset.node = name;
		const summary = document.createElement("summary");
		summary.textContent = name;
		if (state !== undefined) {
			const [label, color] = LIFECYCLE_STATES[state] ?? [`State ${state}`, "lightgray"];
			const badge = document.createElement("span");
			badge.className = "nodemgr_state";
			badge.textContent = label;
			badge.style.color = color;
			details.style.borderLeftColor = color;
			summary.append(" ", badge);
		}
		const info = document.createElement("pre");
		info.className = "inspector_echo";
		info.textContent = "Loading ros2 node info...";
		const kill = confirmButton("Kill node", async () => {
			try {
				const response = await this.call("/vizanti/node/kill", "vizanti_msgs/srv/ManageNode", { node: name }, SLOW_MS);
				info.textContent = response.message || "Kill sent.";
			} catch (e) {
				info.textContent = `Failed: ${e.message}`;
			}
			setTimeout(() => this.loadNodes(), 1500);
		}, "delete_button");
		const note = document.createElement("p");
		note.className = "comment";
		note.textContent = "A node set to respawn starts again by itself. A killed node can stay listed until ROS notices it is gone.";
		details.append(summary, info, kill, note);
		details.addEventListener("toggle", async () => {
			if (!details.open)
				return;
			try {
				const response = await this.call("/vizanti/node/info", "vizanti_msgs/srv/ManageNode", { node: name }, SLOW_MS);
				info.textContent = response.message;
			} catch (e) {
				info.textContent = `ros2 node info failed: ${e.message}`;
			}
		});
		details.open = open;
		return details;
	}

	async runDoctor() {
		this.doctorOutput.hidden = false;
		this.doctorOutput.textContent = "Running ros2 doctor (this can take several seconds)...";
		try {
			const response = await this.call("/vizanti/roswtf", "std_srvs/srv/Trigger", {}, SLOW_MS);
			this.doctorOutput.textContent = stripEscapes(response.message);
		} catch (e) {
			this.doctorOutput.textContent = `ros2 doctor failed: ${e.message}`;
		}
	}
}
