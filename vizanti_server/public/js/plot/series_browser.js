// The list of topics and their fields at the side of a plot panel, as PlotJuggler's: every topic
// on the ROS graph, a box to record it, and once it is recorded its numeric fields as a tree,
// with their latest values. Fields are dragged onto plots (several at once when selected), or
// selected and added with a plot's "+" (the way on a touch screen), or added to the active plot
// with a double-click.

import { SERIES_MIME } from './plot_view.js';
import { formatValue } from './chart_math.js';

const MAX_ROWS = 1500;          // field rows drawn at once; a search narrows the rest
const VALUES_EVERY_MS = 250;
const TOPICS_EVERY_MS = 5000;

const el = (tag, className, text) => {
	const e = document.createElement(tag);
	if (className)
		e.className = className;
	if (text !== undefined)
		e.textContent = text;
	return e;
};

const key = (topic, field) => `${topic}\n${field}`;
const shortType = (type) => (type ? type.replace("/msg/", "/") : "");

// fields "a/b/c", "a/b/d", "e" -> tree { children: Map(name -> node) }, node.field on leaves
export function fieldTree(fields) {
	const root = { children: new Map() };
	for (const field of fields) {
		const parts = field.split("/");
		let node = root;
		let path = "";
		for (let i = 0; i < parts.length; i++) {
			path = path ? `${path}/${parts[i]}` : parts[i];
			let child = node.children.get(parts[i]);
			if (!child) {
				child = { name: parts[i], path, children: new Map(), field: null };
				node.children.set(parts[i], child);
			}
			if (i === parts.length - 1)
				child.field = field;
			node = child;
		}
	}
	return root;
}

export class SeriesBrowser {

	constructor(panel) {
		this.panel = panel;
		this.selected = new Map();        // key -> { topic, type, field }, in selection order
		this.lastClicked = null;
		this.expandedTopics = new Set();
		this.collapsedGroups = new Set(); // "topic\npath" of groups folded shut
		this.graph = { topics: [], types: [] };
		this.valueCells = [];             // [{ cell, topic, field }] of the drawn leaves
		this.query = "";

		this.element = el("div", "plot_sidebar");
		const top = el("div", "plot_sidebar_top");
		this.search = el("input", "plot_search");
		this.search.type = "search";
		this.search.placeholder = "Filter topics and fields";
		this.search.setAttribute("aria-label", "Filter topics and fields");
		this.search.addEventListener("input", () => {
			this.query = this.search.value.trim().toLowerCase();
			this.render();
		});
		const refresh = el("button", "plot_icon_button", "⟳");
		refresh.type = "button";
		refresh.title = "Refresh the topic list";
		refresh.addEventListener("click", () => this.refreshTopics());
		top.append(this.search, refresh);
		this.list = el("div", "plot_series_list");
		this.list.setAttribute("role", "tree");
		this.footer = el("div", "plot_sidebar_footer");
		this.element.append(top, this.list, this.footer);

		this.list.addEventListener("dragstart", (event) => this._dragStart(event));
		this._valuesTimer = setInterval(() => this._paintValues(), VALUES_EVERY_MS);
		this._topicsTimer = setInterval(() => {
			if (this.element.isConnected && this.element.offsetParent !== null)
				this.refreshTopics();
		}, TOPICS_EVERY_MS);
		this.refreshTopics();
	}

	destroy() {
		clearInterval(this._valuesTimer);
		clearInterval(this._topicsTimer);
		this.element.remove();
	}

	async refreshTopics() {
		try {
			const graph = await this.panel.ctx.listAllTopics();
			if (graph && Array.isArray(graph.topics)) {
				this.graph = graph;
				this.render();
			}
		} catch (e) {
			// rosbridge not connected yet: the next refresh tries again
		}
	}

	// every topic to list: on the graph, plus recorded ones that are not (any more)
	_topics() {
		const types = new Map();
		this.graph.topics.forEach((topic, i) => types.set(topic, this.graph.types[i] ?? ""));
		for (const [topic, type] of this.panel.recordedTopics()) {
			if (!types.has(topic) || (!types.get(topic) && type))
				types.set(topic, type);
		}
		return [...types].sort((a, b) => a[0].localeCompare(b[0]));
	}

	selectedRefs() {
		return [...this.selected.values()];
	}

	clearSelection() {
		this.selected.clear();
		this.render();
	}

	render() {
		const scroll = this.list.scrollTop;
		this.list.replaceChildren();
		this.valueCells = [];
		this.leafOrder = [];
		const words = this.query.split(/\s+/).filter(Boolean);
		const recorded = this.panel.recordedTopics();
		let rows = 0;
		let hiddenRows = 0;
		for (const [topic, type] of this._topics()) {
			const fields = this.panel.store.fieldsOf(topic);
			const topicText = `${topic} ${type}`.toLowerCase();
			const topicMatches = words.every((w) => topicText.includes(w));
			const matchingFields = words.length === 0 || topicMatches ? fields
				: fields.filter((f) => words.every((w) => `${topic}/${f} ${type}`.toLowerCase().includes(w)));
			if (words.length && !topicMatches && matchingFields.length === 0)
				continue;
			const isRecorded = recorded.has(topic);
			const expanded = this.expandedTopics.has(topic) || (words.length > 0 && matchingFields.length > 0 && !topicMatches);
			this.list.appendChild(this._topicRow(topic, type, isRecorded, expanded, fields.length));
			if (!expanded)
				continue;
			if (fields.length === 0) {
				const info = this.panel.store.info(topic);
				const note = el("div", "plot_series_note", info?.status || (isRecorded ? "Waiting for data…" : "Not recorded."));
				this.list.appendChild(note);
				continue;
			}
			const tree = fieldTree(matchingFields);
			const walk = (node, depth) => {
				for (const child of node.children.values()) {
					if (rows >= MAX_ROWS) {
						hiddenRows++;
						continue;
					}
					const groupKey = key(topic, child.path);
					const isGroup = child.children.size > 0;
					const open = isGroup && (words.length > 0 || !this.collapsedGroups.has(groupKey));
					if (child.field !== null) {
						this.list.appendChild(this._leafRow(topic, type, child.field, child.name, depth, isGroup, open, groupKey));
						rows++;
					} else {
						this.list.appendChild(this._groupRow(child.name, depth, open, groupKey));
						rows++;
					}
					if (open)
						walk(child, depth + 1);
				}
			};
			walk(tree, 1);
			for (const [field, reason] of this.panel.store.info(topic)?.skipped ?? []) {
				if (words.length === 0)
					this.list.appendChild(el("div", "plot_series_note", `${field}: left out, ${reason}. Raise "Max array" to plot it.`));
			}
		}
		this.footer.textContent = hiddenRows ? `${hiddenRows} more fields not shown; type in the filter to find them.`
			: this.selected.size ? `${this.selected.size} selected: drag onto a plot, or press a plot's +.` : "Tick a topic to record it; drag its fields onto a plot.";
		this.list.scrollTop = scroll;
		this._paintValues();
	}

	_topicRow(topic, type, isRecorded, expanded, fieldCount) {
		const row = el("div", "plot_series_row plot_topic_row");
		row.setAttribute("role", "treeitem");
		row.setAttribute("aria-expanded", String(expanded));
		const twisty = el("button", "plot_twisty", expanded ? "▾" : "▸");
		twisty.type = "button";
		twisty.title = expanded ? "Hide its fields" : "Show its fields (records the topic)";
		const box = el("input", "plot_record");
		box.type = "checkbox";
		box.checked = isRecorded;
		box.title = "Record this topic (every numeric field is kept for the buffer length)";
		const plotted = this.panel.plottedTopics().has(topic);
		box.disabled = plotted && isRecorded;
		if (box.disabled)
			box.title = "Recorded because a plot uses it";
		const name = el("span", "plot_topic_name", topic);
		const info = this.panel.store.info(topic);
		const meta = el("span", "plot_topic_meta", info?.active && info.rate > 0 ? `${info.rate.toFixed(info.rate < 10 ? 1 : 0)} Hz` : shortType(type));
		meta.title = type;
		row.append(twisty, box, name, meta);
		const toggle = () => {
			if (expanded) {
				this.expandedTopics.delete(topic);
			} else {
				this.expandedTopics.add(topic);
				if (!isRecorded)
					this.panel.setPinned(topic, type, true); // fields are known once data arrives
			}
			this.render();
		};
		twisty.addEventListener("click", toggle);
		name.addEventListener("click", toggle);
		box.addEventListener("change", () => {
			this.panel.setPinned(topic, type, box.checked);
			if (box.checked)
				this.expandedTopics.add(topic);
			this.render();
		});
		return row;
	}

	_groupRow(name, depth, open, groupKey) {
		const row = el("div", "plot_series_row plot_group_row");
		row.style.paddingLeft = `${depth * 12 + 4}px`;
		const twisty = el("span", "plot_twisty", open ? "▾" : "▸");
		row.append(twisty, el("span", "plot_field_name", name));
		row.addEventListener("click", () => {
			if (open)
				this.collapsedGroups.add(groupKey);
			else
				this.collapsedGroups.delete(groupKey);
			this.render();
		});
		return row;
	}

	// a field (it can also be a group, as with a quaternion's roll / pitch / yaw beside x..w)
	_leafRow(topic, type, field, name, depth, isGroup, open, groupKey) {
		const row = el("div", "plot_series_row plot_leaf_row");
		row.setAttribute("role", "treeitem");
		row.draggable = true;
		row.dataset.topic = topic;
		row.dataset.type = type;
		row.dataset.field = field;
		row.style.paddingLeft = `${depth * 12 + 4}px`;
		row.classList.toggle("plot_selected", this.selected.has(key(topic, field)));
		const twisty = el("span", "plot_twisty", isGroup ? (open ? "▾" : "▸") : "");
		const label = el("span", "plot_field_name", name);
		label.title = `${topic}/${field}`;
		const value = el("span", "plot_field_value");
		row.append(twisty, label, value);
		this.valueCells.push({ cell: value, topic, field });
		this.leafOrder.push({ topic, type, field });
		if (isGroup) {
			twisty.addEventListener("click", (event) => {
				event.stopPropagation();
				if (open)
					this.collapsedGroups.add(groupKey);
				else
					this.collapsedGroups.delete(groupKey);
				this.render();
			});
		}
		row.addEventListener("click", (event) => this._select({ topic, type, field }, event));
		row.addEventListener("dblclick", () => this.panel.addToActive([{ topic, type, field }]));
		return row;
	}

	_select(ref, event) {
		const k = key(ref.topic, ref.field);
		if (event.shiftKey && this.lastClicked) {
			const order = this.leafOrder.map((r) => key(r.topic, r.field));
			const a = order.indexOf(this.lastClicked), b = order.indexOf(k);
			if (a !== -1 && b !== -1) {
				for (let i = Math.min(a, b); i <= Math.max(a, b); i++)
					this.selected.set(order[i], this.leafOrder[i]);
			}
		} else if (event.ctrlKey || event.metaKey || event.pointerType === "touch" || this.panel.touch) {
			if (this.selected.has(k))
				this.selected.delete(k);
			else
				this.selected.set(k, ref);
		} else {
			const only = this.selected.size === 1 && this.selected.has(k);
			this.selected.clear();
			if (!only)
				this.selected.set(k, ref);
		}
		this.lastClicked = k;
		this.render();
	}

	_dragStart(event) {
		const row = event.target.closest?.(".plot_leaf_row");
		if (!row) {
			event.preventDefault();
			return;
		}
		const ref = { topic: row.dataset.topic, type: row.dataset.type, field: row.dataset.field };
		const refs = this.selected.has(key(ref.topic, ref.field)) ? this.selectedRefs() : [ref];
		event.dataTransfer.setData(SERIES_MIME, JSON.stringify(refs));
		event.dataTransfer.setData("text/plain", refs.map((r) => `${r.topic}/${r.field}`).join("\n"));
		event.dataTransfer.effectAllowed = "copy";
	}

	_paintValues() {
		if (!this.element.isConnected)
			return;
		for (const { cell, topic, field } of this.valueCells) {
			const series = this.panel.store.series(topic, field);
			const text = series?.length ? formatValue(series.lastValue) : "";
			if (cell.textContent !== text)
				cell.textContent = text;
		}
	}
}
