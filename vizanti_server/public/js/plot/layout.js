// What a plot panel shows and saves: tabs, each a tree of splits with plots at the leaves, as in
// PlotJuggler. Pure: every operation returns a new state and leaves its input alone, and
// normalizeState() turns anything saved (older, hand-edited, broken) into a valid state.
//
// state = {
//   version: 1,
//   tabs: [{ id, name, root }], active: tab id,
//   window: s shown while following, buffer: s kept, timeSource: "receive" | "header",
//   maxArray: longest array split into fields, pinned: [{ topic, type }] (recorded, not plotted),
//   sidebar: px width of the series list (0 = hidden)
// }
// node  = { kind: "plot", id, mode: "time" | "xy", curves: [curve], y: null | [lo, hi], legend: "right" | "left" | "hidden" }
//       | { kind: "split", id, direction: "row" | "column", children: [node, ...], sizes: [fraction, ...] }
// curve = time: { topic, type, field, color, transform, hidden }
//         xy:   { x: { topic, type, field }, y: { topic, type, field }, color, hidden }

import { normalizeTransform } from './transforms.js';

export const PALETTE = ["#4e9cf5", "#f5a623", "#4fd68a", "#ff6b6b", "#c27dff", "#2fd3d3", "#f78fd1", "#c8d64f", "#ff9e57", "#9aa8b8"];

export const LEGEND_PLACES = ["right", "left", "hidden"];

export const LIMITS = {
	window: [0.5, 3600],
	buffer: [1, 3600],
	maxArray: [1, 100000],
	sidebar: [0, 800],
};

let counter = 0;
export function uid(prefix = "p") {
	counter = (counter + 1) % 1e6;
	return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
}

export function newPlot(mode = "time") {
	return { kind: "plot", id: uid("plot"), mode, curves: [], y: null, legend: "right" };
}

export function newTab(name = "Tab 1") {
	return { id: uid("tab"), name, root: newPlot() };
}

export function defaultState() {
	const tab = newTab("Tab 1");
	return { version: 1, tabs: [tab], active: tab.id, window: 10, buffer: 60, timeSource: "receive", maxArray: 500, pinned: [], sidebar: 240 };
}

const clamp = (value, [lo, hi], fallback) => {
	const n = Number(value);
	return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
const isString = (v) => typeof v === "string";
const COLOR = /^#[0-9a-fA-F]{6}$/;

function normalizeRef(ref) {
	if (!ref || !isString(ref.topic) || !ref.topic.startsWith("/") || !isString(ref.field) || ref.field === "")
		return null;
	return { topic: ref.topic, type: isString(ref.type) ? ref.type : "", field: ref.field };
}

function normalizeCurve(curve, mode, index) {
	const color = curve && isString(curve.color) && COLOR.test(curve.color) ? curve.color : PALETTE[index % PALETTE.length];
	const hidden = !!curve?.hidden;
	if (mode === "xy") {
		const x = normalizeRef(curve?.x);
		const y = normalizeRef(curve?.y);
		return x && y ? { x, y, color, hidden } : null;
	}
	const ref = normalizeRef(curve);
	return ref ? { ...ref, color, transform: normalizeTransform(curve.transform), hidden } : null;
}

function normalizeNode(node, depth = 0) {
	if (depth > 32 || !node || typeof node !== "object")
		return newPlot();
	if (node.kind === "split" && Array.isArray(node.children)) {
		const children = node.children.map((child) => normalizeNode(child, depth + 1));
		if (children.length === 0)
			return newPlot();
		if (children.length === 1)
			return children[0];
		const raw = Array.isArray(node.sizes) && node.sizes.length === children.length ? node.sizes.map(Number) : [];
		const sizes = raw.length && raw.every((s) => Number.isFinite(s) && s > 0) ? normalizeSizes(raw) : children.map(() => 1 / children.length);
		return { kind: "split", id: isString(node.id) && node.id ? node.id : uid("split"), direction: node.direction === "column" ? "column" : "row", children, sizes };
	}
	const mode = node.mode === "xy" ? "xy" : "time";
	const curves = (Array.isArray(node.curves) ? node.curves : []).map((c, i) => normalizeCurve(c, mode, i)).filter(Boolean);
	const y = Array.isArray(node.y) && node.y.length === 2 && node.y.every(Number.isFinite) && node.y[1] > node.y[0] ? [node.y[0], node.y[1]] : null;
	const legend = LEGEND_PLACES.includes(node.legend) ? node.legend : "right";
	return { kind: "plot", id: isString(node.id) && node.id ? node.id : uid("plot"), mode, curves, y, legend };
}

function normalizeSizes(sizes) {
	const total = sizes.reduce((a, b) => a + b, 0);
	return sizes.map((s) => s / total);
}

// a valid state from anything (null, an older or broken save); ids are kept, missing ones made
export function normalizeState(saved) {
	const base = defaultState();
	if (!saved || typeof saved !== "object")
		return base;
	const seen = new Set();
	const tabs = (Array.isArray(saved.tabs) ? saved.tabs : []).map((tab, i) => {
		let id = isString(tab?.id) && tab.id ? tab.id : uid("tab");
		if (seen.has(id))
			id = uid("tab");
		seen.add(id);
		return { id, name: isString(tab?.name) && tab.name.trim() ? tab.name.slice(0, 60) : `Tab ${i + 1}`, root: normalizeNode(tab?.root) };
	});
	if (tabs.length === 0)
		tabs.push(base.tabs[0]);
	const pinned = (Array.isArray(saved.pinned) ? saved.pinned : [])
		.filter((p) => p && isString(p.topic) && p.topic.startsWith("/"))
		.map((p) => ({ topic: p.topic, type: isString(p.type) ? p.type : "" }));
	return {
		version: 1,
		tabs,
		active: tabs.some((t) => t.id === saved.active) ? saved.active : tabs[0].id,
		window: clamp(saved.window, LIMITS.window, base.window),
		buffer: clamp(saved.buffer, LIMITS.buffer, base.buffer),
		timeSource: saved.timeSource === "header" ? "header" : "receive",
		maxArray: Math.round(clamp(saved.maxArray, LIMITS.maxArray, base.maxArray)),
		pinned: [...new Map(pinned.map((p) => [p.topic, p])).values()],
		sidebar: Math.round(clamp(saved.sidebar, LIMITS.sidebar, base.sidebar)),
	};
}

// ---- tree queries ----

export function findNode(root, id) {
	if (root.id === id)
		return root;
	if (root.kind === "split") {
		for (const child of root.children) {
			const found = findNode(child, id);
			if (found)
				return found;
		}
	}
	return null;
}

export function plotsIn(root) {
	if (root.kind === "plot")
		return [root];
	return root.children.flatMap(plotsIn);
}

// the series a curve reads, one for a time curve and two for an XY one
export function refsOf(curve) {
	return "x" in curve ? [curve.x, curve.y] : [curve];
}

// every topic the state needs recorded: { topic -> type } (plotted and pinned)
export function topicsIn(state) {
	const topics = new Map();
	for (const tab of state.tabs) {
		for (const plot of plotsIn(tab.root)) {
			for (const curve of plot.curves) {
				for (const ref of refsOf(curve)) {
					if (!topics.get(ref.topic))
						topics.set(ref.topic, ref.type);
				}
			}
		}
	}
	for (const { topic, type } of state.pinned) {
		if (!topics.get(topic))
			topics.set(topic, type);
	}
	return topics;
}

// ---- tree edits (each returns a new root) ----

// replaces the node with that id by fn(node)
export function mapNode(root, id, fn) {
	if (root.id === id)
		return fn(root);
	if (root.kind === "split") {
		let changed = false;
		const children = root.children.map((child) => {
			const next = mapNode(child, id, fn);
			if (next !== child)
				changed = true;
			return next;
		});
		return changed ? { ...root, children } : root;
	}
	return root;
}

function parentOf(root, id) {
	if (root.kind !== "split")
		return null;
	for (const child of root.children) {
		if (child.id === id)
			return root;
		const found = parentOf(child, id);
		if (found)
			return found;
	}
	return null;
}

// Puts a new, empty plot beside plot `id`: to its right ("row") or below it ("column").
// Returns { root, plot } (the new plot). A split in the same direction gains a child (taking
// half of this plot's share) rather than nesting another split.
export function splitPlot(root, id, direction) {
	const plot = newPlot();
	const parent = parentOf(root, id);
	if (parent && parent.direction === direction) {
		const at = parent.children.findIndex((c) => c.id === id);
		const share = parent.sizes[at] / 2;
		return {
			plot,
			root: mapNode(root, parent.id, (p) => ({
				...p,
				children: [...p.children.slice(0, at + 1), plot, ...p.children.slice(at + 1)],
				sizes: [...p.sizes.slice(0, at), share, share, ...p.sizes.slice(at + 1)],
			})),
		};
	}
	return {
		plot,
		root: mapNode(root, id, (node) => ({ kind: "split", id: uid("split"), direction, children: [node, plot], sizes: [0.5, 0.5] })),
	};
}

// removes node `id`; a split left with one child is replaced by it, and removing the last plot
// leaves one empty plot
export function removeNode(root, id) {
	if (root.id === id)
		return newPlot();
	const remove = (node) => {
		if (node.kind !== "split")
			return node;
		const at = node.children.findIndex((c) => c.id === id);
		if (at !== -1) {
			const children = node.children.filter((_, i) => i !== at);
			if (children.length === 1)
				return children[0];
			return { ...node, children, sizes: normalizeSizes(node.sizes.filter((_, i) => i !== at)) };
		}
		let changed = false;
		const children = node.children.map((child) => {
			const next = remove(child);
			if (next !== child)
				changed = true;
			return next;
		});
		return changed ? { ...node, children } : node;
	};
	return remove(root);
}

export function setSizes(root, splitId, sizes) {
	return mapNode(root, splitId, (node) => {
		if (node.kind !== "split" || sizes.length !== node.children.length || !sizes.every((s) => Number.isFinite(s) && s > 0))
			return node;
		return { ...node, sizes: normalizeSizes(sizes) };
	});
}

// the first palette colour no curve of the plot uses yet
export function nextColor(plot) {
	const used = new Set(plot.curves.map((c) => c.color.toLowerCase()));
	return PALETTE.find((c) => !used.has(c.toLowerCase())) ?? PALETTE[plot.curves.length % PALETTE.length];
}

const sameRef = (a, b) => a.topic === b.topic && a.field === b.field;

// adds a time curve for `ref` ({ topic, type, field }) unless the plot shows it already
export function addCurve(root, plotId, ref) {
	return mapNode(root, plotId, (plot) => {
		if (plot.kind !== "plot" || plot.mode !== "time" || plot.curves.some((c) => sameRef(c, ref)))
			return plot;
		return { ...plot, curves: [...plot.curves, { topic: ref.topic, type: ref.type ?? "", field: ref.field, color: nextColor(plot), transform: { kind: "none" }, hidden: false }] };
	});
}

// adds an XY curve (x against y) unless the plot has that pair already
export function addXYCurve(root, plotId, x, y) {
	return mapNode(root, plotId, (plot) => {
		if (plot.kind !== "plot" || plot.mode !== "xy" || plot.curves.some((c) => sameRef(c.x, x) && sameRef(c.y, y)))
			return plot;
		const ref = (r) => ({ topic: r.topic, type: r.type ?? "", field: r.field });
		return { ...plot, curves: [...plot.curves, { x: ref(x), y: ref(y), color: nextColor(plot), hidden: false }] };
	});
}

export function updateCurve(root, plotId, index, changes) {
	return mapNode(root, plotId, (plot) => {
		if (plot.kind !== "plot" || !plot.curves[index])
			return plot;
		const curves = plot.curves.slice();
		curves[index] = { ...curves[index], ...changes };
		if ("transform" in changes)
			curves[index].transform = normalizeTransform(changes.transform);
		return { ...plot, curves };
	});
}

export function removeCurve(root, plotId, index) {
	return mapNode(root, plotId, (plot) => (plot.kind === "plot" ? { ...plot, curves: plot.curves.filter((_, i) => i !== index) } : plot));
}

// switches a plot between time series and XY; its curves do not carry over (they mean different things)
export function setMode(root, plotId, mode) {
	return mapNode(root, plotId, (plot) => (plot.kind === "plot" && plot.mode !== mode ? { ...plot, mode, curves: [], y: null } : plot));
}

// the legend's next place: right -> left -> hidden -> right
export function cycleLegend(root, plotId) {
	return mapNode(root, plotId, (plot) => {
		if (plot.kind !== "plot")
			return plot;
		const next = LEGEND_PLACES[(LEGEND_PLACES.indexOf(plot.legend ?? "right") + 1) % LEGEND_PLACES.length];
		return { ...plot, legend: next };
	});
}

export function setYRange(root, plotId, y) {
	return mapNode(root, plotId, (plot) => (plot.kind === "plot" ? { ...plot, y } : plot));
}

// ---- tabs (each returns a new state) ----

export function addTab(state) {
	const names = new Set(state.tabs.map((t) => t.name));
	let n = state.tabs.length + 1;
	while (names.has(`Tab ${n}`))
		n++;
	const tab = newTab(`Tab ${n}`);
	return { ...state, tabs: [...state.tabs, tab], active: tab.id };
}

export function removeTab(state, tabId) {
	const at = state.tabs.findIndex((t) => t.id === tabId);
	if (at === -1)
		return state;
	const tabs = state.tabs.filter((t) => t.id !== tabId);
	if (tabs.length === 0)
		tabs.push(newTab("Tab 1"));
	const active = state.active === tabId ? tabs[Math.min(at, tabs.length - 1)].id : state.active;
	return { ...state, tabs, active };
}

export function renameTab(state, tabId, name) {
	const clean = String(name).trim().slice(0, 60);
	if (!clean)
		return state;
	return { ...state, tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, name: clean } : t)) };
}

export function moveTab(state, tabId, toIndex) {
	const from = state.tabs.findIndex((t) => t.id === tabId);
	if (from === -1)
		return state;
	const tabs = state.tabs.slice();
	const [tab] = tabs.splice(from, 1);
	tabs.splice(Math.max(0, Math.min(tabs.length, toIndex)), 0, tab);
	return { ...state, tabs };
}

export function setTabRoot(state, tabId, root) {
	return { ...state, tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, root } : t)) };
}
