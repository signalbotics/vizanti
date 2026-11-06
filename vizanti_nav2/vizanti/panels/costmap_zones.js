// The Costmap Zones panel: draw keepout and speed zones for Nav2's costmap filters. It finds the
// filters on the graph (their nav2_msgs/CostmapFilterInfo topics), takes the mask the filter uses
// now (or the map's size when none is published yet), and fills the zones drawn with Publish
// Point into it. Publish sends the mask to the filter at once; Save downloads it as the .pgm and
// .yaml map_server loads a mask from. Not in RViz. Logic: ../zones_logic.js
import { PanelPlugin, WIDGET_PROPERTIES } from '@vizanti/plugin_api.js';
import {
	filterKind, maskValue, valueText, gridFrom, rasterize, maskMessage, toPgm, toYaml, fileName, zoneMarkers, fingerprint,
} from '../zones_logic.js';

if (!document.querySelector("link[data-vizanti-nav2]")) {
	const link = document.createElement("link");
	link.rel = "stylesheet";
	link.href = new URL("../nav2.css", import.meta.url).href;
	link.dataset.vizantiNav2 = "";
	document.head.appendChild(link);
}

const el = (tag, className = "", text = "") => {
	const element = document.createElement(tag);
	if (className)
		element.className = className;
	if (text)
		element.textContent = text;
	return element;
};

const LATCHED = { reliability: "reliable", durability: "transient_local", history: "keep_last", depth: 1 };
const FIND_EVERY_MS = 5000;

export class CostmapZonesPanel extends PanelPlugin {

	static properties = {
		map_topic: { type: "topic", label: "Map topic", default: "/map", help: "Gives the mask its size when the filter has no mask published yet." },
		markers_topic: { type: "string", label: "Zones markers topic", default: "/costmap_zones/markers", help: "The zones being drawn, as a MarkerArray (add a MarkerArray display for it)." },
		...WIDGET_PROPERTIES,
	};

	onCreate() {
		this.filters = new Map(); // info topic -> { topic, info, unsubscribe }
		this.chosen = "";         // info topic
		this.masks = new Map();   // mask topic -> grid (as the filter has it now)
		this.maskSubs = new Map();
		this.map = null;
		this.zones = [];          // { points, value, keepout, label }
		this.drawing = [];        // points of the zone being drawn
		this.line = "";
		this.ours = new Set(); // fingerprints of the masks published from here
		this.unsubscribeMap = this.ctx.subscribe(this.props.map_topic, "nav_msgs/msg/OccupancyGrid", 0, (msg) => { this.map = gridFrom(msg); this.render(); }, LATCHED);
		this.unsubscribeClicks = this.ctx.subscribe("/clicked_point", "geometry_msgs/msg/PointStamped", 0, (msg) => {
			this.drawing.push({ x: msg.point.x, y: msg.point.y });
			this.publishMarkers();
			this.render();
		});
		this.status.warn("Looking for costmap filters…");
		this.find();
	}

	onDestroy() {
		this.destroyed = true;
		clearTimeout(this.findTimer);
		this.unsubscribeMap?.();
		this.unsubscribeClicks?.();
		for (const f of this.filters.values())
			f.unsubscribe?.();
		for (const off of this.maskSubs.values())
			off();
	}

	onPropertyChange(key) {
		if (key === "map_topic") {
			this.unsubscribeMap?.();
			this.map = null;
			this.unsubscribeMap = this.ctx.subscribe(this.props.map_topic, "nav_msgs/msg/OccupancyGrid", 0, (msg) => { this.map = gridFrom(msg); this.render(); }, LATCHED);
		}
	}

	// ---- the filters on the graph ----

	async find() {
		if (this.destroyed)
			return;
		try {
			const { topics, types } = await this.ctx.listAllTopics();
			const infoTopics = topics.filter((t, i) => types[i] === "nav2_msgs/msg/CostmapFilterInfo");
			for (const topic of infoTopics) {
				if (this.filters.has(topic))
					continue;
				const filter = { topic, info: null };
				filter.unsubscribe = this.ctx.subscribe(topic, "nav2_msgs/msg/CostmapFilterInfo", 0, (info) => {
					filter.info = info;
					this.watchMask(info.filter_mask_topic);
					if (!this.chosen)
						this.chosen = topic;
					this.render();
				}, LATCHED);
				this.filters.set(topic, filter);
			}
			if (infoTopics.length === 0)
				this.status.warn("No costmap filter found (no nav2_msgs/msg/CostmapFilterInfo topic). Run costmap_filter_info_server for a keepout or speed filter.");
			else
				this.status.ok(`${infoTopics.length} costmap filter${infoTopics.length === 1 ? "" : "s"}.`);
		} catch (e) {
			// rosbridge not connected yet
		}
		this.render();
		this.findTimer = setTimeout(() => this.find(), FIND_EVERY_MS);
	}

	watchMask(topic) {
		if (!topic || this.maskSubs.has(topic))
			return;
		this.maskSubs.set(topic, this.ctx.subscribe(topic, "nav_msgs/msg/OccupancyGrid", 0, (msg) => {
			// our own mask comes back too: the grid stays the filter's own (from its mask server),
			// so a zone removed here goes from the mask published next
			const grid = gridFrom(msg);
			if (!this.ours.has(fingerprint(grid.data)))
				this.masks.set(topic, grid);
			this.render();
		}, LATCHED));
	}

	get filter() {
		return this.filters.get(this.chosen)?.info ?? null;
	}

	// the grid the zones go into: the filter's current mask, else the map's size
	get grid() {
		const info = this.filter;
		const mask = info ? this.masks.get(info.filter_mask_topic) : null;
		if (mask)
			return { grid: mask, from: `the current mask on ${info.filter_mask_topic}` };
		if (this.map)
			return { grid: { ...this.map, data: new Int8Array(this.map.width * this.map.height) }, from: `the size of ${this.props.map_topic} (no mask published yet)` };
		return { grid: null, from: null };
	}

	// ---- the page ----

	buildPanel(container) {
		container.classList.add("nav2_panel", "nav2_zones");
		this.container = container;
		const grid = el("div", "nav2_grid");
		this.filterSelect = el("select");
		this.filterSelect.addEventListener("change", () => {
			this.chosen = this.filterSelect.value;
			this.render();
		});
		this.limitLabel = el("label", "", "Speed limit:");
		this.limit = el("input");
		this.limit.type = "number";
		this.limit.step = "any";
		this.limit.min = "0";
		grid.append(el("label", "", "Filter:"), this.filterSelect, this.limitLabel, this.limit);

		this.drawNote = el("p", "nav2_tools_hint");
		const drawRow = el("div", "nav2_row");
		this.undoButton = el("button", "nav2_button", "Undo point");
		this.finishButton = el("button", "nav2_button", "Finish zone");
		for (const b of [this.undoButton, this.finishButton])
			b.type = "button";
		this.undoButton.addEventListener("click", () => {
			this.drawing.pop();
			this.publishMarkers();
			this.render();
		});
		this.finishButton.addEventListener("click", () => this.finishZone());
		drawRow.append(this.undoButton, this.finishButton);

		this.zoneList = el("div", "nav2_zone_list");
		this.keep = el("input");
		this.keep.type = "checkbox";
		this.keep.checked = true;
		const keepLabel = el("label", "nav2_check");
		keepLabel.append(this.keep, " Keep the zones already in the mask");

		const actions = el("div", "nav2_row");
		this.publishButton = el("button", "nav2_button", "Publish mask");
		this.publishButton.title = "Send the mask to the filter now (on its mask topic, latched).";
		this.saveButton = el("button", "nav2_button", "Save .pgm + .yaml");
		this.saveButton.title = "Download the mask as map_server loads it (mode: raw).";
		this.clearButton = el("button", "nav2_button", "Clear zones");
		for (const b of [this.publishButton, this.saveButton, this.clearButton])
			b.type = "button";
		this.publishButton.addEventListener("click", () => this.publishMask());
		this.saveButton.addEventListener("click", () => this.saveMask());
		this.clearButton.addEventListener("click", () => {
			this.zones = [];
			this.drawing = [];
			this.publishMarkers();
			this.render();
		});
		actions.append(this.publishButton, this.saveButton, this.clearButton);
		this.note = el("p", "nav2_tools_line");
		this.source = el("p", "nav2_tools_hint");
		container.append(grid, this.drawNote, drawRow, this.zoneList, keepLabel, actions, this.note, this.source,
			el("p", "nav2_tools_hint", `Click the corners with Publish Point. The zones show on ${this.props.markers_topic} (add a MarkerArray display); the published mask on the filter's mask topic (a Map display).`));
		this.render();
	}

	say(text, error = false) {
		this.line = text;
		this.note.classList.toggle("nav2_error", error);
		if (error)
			this.status.warn(text);
		this.render();
	}

	finishZone() {
		const info = this.filter;
		if (!info)
			return this.say("Choose a filter first.", true);
		if (this.drawing.length < 3)
			return this.say("A zone needs at least 3 points (click them with Publish Point).", true);
		const { value, error } = maskValue(info, this.limit.value);
		if (error)
			return this.say(error, true);
		const keepout = filterKind(info).key === "keepout";
		this.zones.push({ points: this.drawing, value, keepout, label: valueText(info, value), filter: this.chosen });
		this.drawing = [];
		this.publishMarkers();
		this.say(`Zone ${this.zones.length} added (${valueText(info, value)}). Publish the mask to use it.`);
	}

	// the zones of the chosen filter, filled into its grid
	build() {
		const info = this.filter;
		const { grid, from } = this.grid;
		if (!info)
			return { error: "Choose a filter first." };
		if (!grid)
			return { error: `No mask and no map yet (waiting for ${info.filter_mask_topic} or ${this.props.map_topic}).` };
		if (Math.abs(grid.yaw) > 1e-6)
			return { error: "The mask is rotated; only unrotated masks are drawn into." };
		const zones = this.zones.filter((z) => z.filter === this.chosen);
		return { info, grid, from, zones, data: rasterize(grid, zones, this.keep.checked) };
	}

	publishMask() {
		const { info, grid, zones, data, error } = this.build();
		if (error)
			return this.say(error, true);
		const t = Date.now();
		this.ours.add(fingerprint(data));
		this.ctx.publish(info.filter_mask_topic, "nav_msgs/msg/OccupancyGrid", maskMessage(grid, data, { sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1e6 }), { latched: true });
		this.say(`Published ${zones.length} zone${zones.length === 1 ? "" : "s"} on ${info.filter_mask_topic} (${grid.width} × ${grid.height} cells).`);
	}

	saveMask() {
		const { info, grid, data, error } = this.build();
		if (error)
			return this.say(error, true);
		const name = fileName(info.filter_mask_topic);
		const download = (blob, file) => {
			const link = document.createElement("a");
			link.href = URL.createObjectURL(blob);
			link.download = file;
			link.click();
			setTimeout(() => URL.revokeObjectURL(link.href), 1000);
		};
		download(new Blob([toPgm(grid, data)], { type: "image/x-portable-graymap" }), `${name}.pgm`);
		download(new Blob([toYaml(name, grid)], { type: "application/x-yaml" }), `${name}.yaml`);
		this.say(`Saved ${name}.pgm and ${name}.yaml. Point the filter's mask server (yaml_filename) at the .yaml.`);
	}

	publishMarkers() {
		const t = Date.now();
		const frame = this.grid.grid?.frame ?? "map";
		this.ctx.publish(this.props.markers_topic, "visualization_msgs/msg/MarkerArray",
			zoneMarkers(this.zones.filter((z) => z.filter === this.chosen), this.drawing, frame, { sec: Math.floor(t / 1000), nanosec: (t % 1000) * 1e6 }));
	}

	render() {
		if (!this.container)
			return;
		const options = [...this.filters.values()].filter((f) => f.info).map((f) => {
			const kind = filterKind(f.info);
			return [f.topic, `${kind.label}${kind.unit ? ` (${kind.unit})` : ""}: ${f.info.filter_mask_topic}`];
		});
		if ([...this.filterSelect.options].map((o) => o.value).join("\n") !== options.map(([v]) => v).join("\n"))
			this.filterSelect.replaceChildren(...options.map(([v, l]) => new Option(l, v)));
		this.filterSelect.value = this.chosen;
		const kind = filterKind(this.filter);
		const speed = !!kind.unit;
		this.limitLabel.hidden = this.limit.hidden = !speed;
		this.limitLabel.textContent = speed ? `Speed limit (${kind.unit}):` : "";
		this.drawNote.textContent = this.drawing.length ? `Drawing: ${this.drawing.length} point${this.drawing.length === 1 ? "" : "s"}.` : "Click the zone's corners with Publish Point, then Finish zone.";
		this.undoButton.disabled = this.drawing.length === 0;
		this.finishButton.disabled = this.drawing.length < 3;
		const zones = this.zones.map((z, i) => [z, i]).filter(([z]) => z.filter === this.chosen);
		this.zoneList.replaceChildren(...zones.map(([z, i]) => {
			const row = el("div", "nav2_row");
			const remove = el("button", "nav2_button nav2_zone_remove", "✕");
			remove.type = "button";
			remove.title = "Remove this zone";
			remove.addEventListener("click", () => {
				this.zones.splice(i, 1);
				this.publishMarkers();
				this.render();
			});
			row.append(el("span", "", `Zone ${zones.findIndex(([, j]) => j === i) + 1}: ${z.label}, ${z.points.length} corners`), remove);
			return row;
		}));
		const ready = !!this.filter && !!this.grid.grid;
		this.publishButton.disabled = this.saveButton.disabled = !ready;
		this.clearButton.disabled = this.zones.length === 0 && this.drawing.length === 0;
		this.note.textContent = this.line;
		this.note.hidden = !this.line;
		this.source.textContent = this.grid.from ? `Mask: ${this.grid.from}.` : "";
	}
}
