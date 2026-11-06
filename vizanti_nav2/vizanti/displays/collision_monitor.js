// The Collision Monitor display: Nav2's collision_monitor zones around the robot, coloured by
// what each does (stop red, slow down orange, approach yellow, limit blue), and filled while it
// acts. The shapes come from the node's parameters, so they show even with visualize: false; a
// zone that follows the footprint or the speed is drawn from its topic. Not in RViz (which shows
// a zone only through a Polygon display of its published outline). Logic: ../collision_monitor_logic.js
import * as THREE from '@vizanti/lib/three.module.min.js';
import { Display } from '@vizanti/plugin_api.js';
import { ZONE_PARAMS, paramMap, zonesFrom, stateText, ACTIONS } from '../collision_monitor_logic.js';
import { topicOfNode } from '../nav2_names.js';

const RELOAD_MS = 5000;

export class CollisionMonitorDisplay extends Display {

	static msgTypes = ["nav2_msgs/msg/CollisionMonitorState"];

	static properties = {
		topic: { type: "topic", label: "State topic", default: "/collision_monitor_state", help: "Which zone is acting. Left at the default, it follows the node's state_topic parameter." },
		node: { type: "string", label: "Collision monitor node", default: "collision_monitor", help: "The node whose zones (parameters) are drawn, with its namespace if it has one (robot1/collision_monitor). Topics it names relative to itself are taken in that namespace." },
		alpha: { type: "float", label: "Fill alpha", default: 0.35, min: 0, max: 1, step: 0.05, slider: true, help: "How strongly the acting zone is filled." },
		thickness: { type: "int", label: "Line thickness (px)", default: 3, min: 1, max: 20 },
	};

	onCreate() {
		this.zones = [];
		this.drawn = new Map(); // zone name -> { lines, fill, points }
		this.subscriptions = [];
		this.acting = null; // polygon_name of the acting zone
		this.status.warn("Reading the collision monitor's zones…");
		this.load();
	}

	onDestroy() {
		this.destroyed = true;
		clearTimeout(this.reloadTimer);
		this.clearZones();
	}

	onPropertyChange(key) {
		if (key === "node") {
			clearTimeout(this.reloadTimer);
			this.load();
		}
		if (key === "alpha" || key === "thickness")
			this.restyle();
	}

	// ---- zones from the parameters ----

	// One name the node has not declared, or declared without a value (FootprintApproach.points
	// in nav2_bringup), empties the whole get_parameters answer. So: only declared names, and
	// when a batch still comes back empty, one name at a time.
	async get(names) {
		if (names.length === 0)
			return {};
		const service = `/${this.props.node.replace(/^\//, "")}/get_parameters`;
		const ask = (list) => this.ctx.callService(service, "rcl_interfaces/srv/GetParameters", { names: list }, 3000);
		const response = await ask(names);
		if ((response?.values?.length ?? 0) === names.length || names.length === 1)
			return paramMap(names, response);
		const each = await Promise.all(names.map(async (name) => paramMap([name], await ask([name]).catch(() => null))));
		return Object.assign({}, ...each);
	}

	async declared(prefixes) {
		const response = await this.ctx.callService(`/${this.props.node.replace(/^\//, "")}/list_parameters`, "rcl_interfaces/srv/ListParameters", { prefixes, depth: 0 }, 3000);
		return new Set(response?.result?.names ?? []);
	}

	async load() {
		if (this.destroyed)
			return;
		try {
			const declared = await this.declared([]); // every parameter it has (Humble has no state_topic)
			const top = await this.get(["polygons", "base_frame_id", "state_topic"].filter((n) => declared.has(n)));
			// the state topic is where the node says it publishes, unless set here by hand
			const stateTopic = top.state_topic ? topicOfNode(this.props.node, top.state_topic) : null;
			if (stateTopic && this.props.topic === CollisionMonitorDisplay.properties.topic.default && stateTopic !== this.props.topic)
				this.setProp("topic", stateTopic);
			if (!top.polygons) {
				this.status.warn(`${this.props.node} has no polygons parameter (is it running?). Trying again…`);
				this.reloadTimer = setTimeout(() => this.load(), RELOAD_MS);
				return;
			}
			const names = top.polygons.flatMap((zone) => ZONE_PARAMS.map((p) => `${zone}.${p}`)).filter((n) => declared.has(n));
			const perZone = names.length ? await this.get(names) : {};
			this.build(zonesFrom(top, perZone));
		} catch (e) {
			this.status.warn(`${this.props.node} did not answer (${e.message}). Trying again…`);
			this.reloadTimer = setTimeout(() => this.load(), RELOAD_MS);
		}
	}

	clearZones() {
		for (const off of this.subscriptions)
			off();
		this.subscriptions = [];
		for (const d of this.drawn.values()) {
			this.ctx.scene.disposeLines(d.lines);
			d.fill.geometry.dispose();
			d.fill.material.dispose();
			this.root.remove(d.fill);
		}
		this.drawn.clear();
	}

	build(zones) {
		this.clearZones();
		this.zones = zones;
		const frame = zones[0]?.frame ?? "base_footprint";
		if (!this.setFrame({ frame_id: frame }, { follow: true })) {
			this.reloadTimer = setTimeout(() => this.build(zones), RELOAD_MS); // TF not there yet
			return;
		}
		for (const zone of zones) {
			const lines = this.add(this.ctx.scene.makeLines({ color: zone.action.color, linewidth: this.props.thickness, opacity: zone.enabled ? 1 : 0.35 }));
			const fill = this.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ color: zone.action.color, transparent: true, opacity: this.props.alpha, depthWrite: false, side: THREE.DoubleSide })));
			fill.visible = false;
			const d = { zone, lines, fill, points: null };
			this.drawn.set(zone.name, d);
			if (zone.shape === "points")
				this.shape(d, zone.points);
			else if (zone.topic) {
				this.subscriptions.push(this.ctx.subscribe(topicOfNode(this.props.node, zone.topic), "geometry_msgs/msg/PolygonStamped", 100, (msg) => this.fromTopic(d, msg)));
			}
		}
		const missing = zones.filter((z) => z.shape === "none").map((z) => z.name);
		const info = { "Frame": frame, "Zones": zones.map((z) => `${z.name} (${z.action.label}${z.enabled ? "" : ", disabled"})`).join(", ") || "none" };
		this.setInfo(info);
		if (zones.length === 0)
			this.status.warn(`${this.props.node} has no zones.`);
		else if (missing.length)
			this.status.warn(`No shape for ${missing.join(", ")} (a velocity polygon shows only with visualize: true).`);
		else
			this.status.ok(`${zones.length} zone${zones.length === 1 ? "" : "s"}. ${this.acting ? "" : "Waiting for the state topic."}`.trim());
		this.paintActing();
	}

	// a footprint or published outline: its own frame, brought into the zones' frame
	fromTopic(d, msg) {
		const from = msg.header?.frame_id || d.zone.frame;
		const tf = this.ctx.tf;
		const points = (msg.polygon?.points ?? []).map((p) => {
			if (from === d.zone.frame)
				return { x: p.x, y: p.y };
			const t = tf.transformPose(from, d.zone.frame, { x: p.x, y: p.y, z: 0 }, new Quaternion());
			return { x: t.translation.x, y: t.translation.y };
		});
		if (points.length >= 3)
			this.shape(d, points);
	}

	shape(d, points) {
		d.points = points;
		const z = 0.02;
		const segments = [];
		for (let i = 0; i < points.length; i++) {
			const a = points[i];
			const b = points[(i + 1) % points.length];
			segments.push(a.x, a.y, z, b.x, b.y, z);
		}
		this.ctx.scene.setLinePositions(d.lines, new Float32Array(segments));
		const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p.x, p.y)));
		d.fill.geometry.dispose();
		d.fill.geometry = new THREE.ShapeGeometry(shape);
		d.fill.position.z = z / 2;
		this.requestRender();
	}

	restyle() {
		for (const d of this.drawn.values()) {
			d.lines.material.linewidth = this.props.thickness;
			d.fill.material.opacity = this.props.alpha;
		}
		this.requestRender();
	}

	// ---- which zone acts ----

	onMessage(msg) {
		const action = ACTIONS[msg.action_type] ?? ACTIONS[0];
		this.acting = action.key === "none" ? null : msg.polygon_name;
		this.paintActing();
		const text = stateText(msg);
		if (this.acting)
			this.status.warn(text);
		else if (this.zones.length)
			this.status.ok(text);
		this.setInfo({ ...(this.info ?? {}), "State": text });
	}

	paintActing() {
		for (const [name, d] of this.drawn)
			d.fill.visible = name === this.acting && !!d.points;
		this.requestRender();
	}
}
