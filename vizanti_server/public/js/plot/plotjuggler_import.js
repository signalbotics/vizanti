// A PlotJuggler layout file (.xml, "Save layout") as plot panel tabs. Pure, so it runs under
// node --test. What carries over: tabs and their names, the splits (orientation and sizes), time
// series and XY plots, curve colours, and fixed value ranges. PlotJuggler's custom (Lua) series,
// plugins' settings and its data sources do not.
//
// PlotJuggler names a curve "/topic/field/path" without marking where the topic ends, so the
// name is matched against the topics given (longest first); a name no topic matches is split
// after its first segment, which is right for the usual single-level topics.

import { PALETTE, uid } from './layout.js';

// a tiny XML reader: elements with attributes and children (no text content needed)
function parseXml(text) {
	const root = { tag: "#root", attrs: {}, children: [] };
	const stack = [root];
	const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
	let m;
	while ((m = re.exec(text))) {
		if (!m[2])
			continue;
		const [, closing, tag, attrText, selfClosing] = m;
		if (closing) {
			if (stack.length > 1)
				stack.pop();
			continue;
		}
		const attrs = {};
		for (const a of attrText.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
			attrs[a[1]] = decode(a[2] ?? a[3]);
		const element = { tag, attrs, children: [] };
		stack[stack.length - 1].children.push(element);
		if (!selfClosing)
			stack.push(element);
	}
	return root;
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const child = (e, tag) => e.children.find((c) => c.tag === tag);
const children = (e, tag) => e.children.filter((c) => c.tag === tag);

// "/a/b/c/d" -> { topic, field } using the known topics (longest match first)
export function splitSeriesName(name, topics = []) {
	const clean = name.startsWith("/") ? name : `/${name}`;
	const known = [...topics].sort((a, b) => b.length - a.length).find((t) => clean.startsWith(`${t}/`) && clean.length > t.length + 1);
	if (known)
		return { topic: known, field: clean.slice(known.length + 1) };
	const at = clean.indexOf("/", 1);
	if (at === -1)
		return null;
	return { topic: clean.slice(0, at), field: clean.slice(at + 1) };
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

function plotFrom(plotElement, topics, typeOf) {
	const mode = plotElement.attrs.mode === "XYPlot" ? "xy" : "time";
	const ref = (name) => {
		const r = name ? splitSeriesName(name, topics) : null;
		return r ? { ...r, type: typeOf(r.topic) } : null;
	};
	const curves = [];
	for (const c of children(plotElement, "curve")) {
		const color = COLOR.test(c.attrs.color ?? "") ? c.attrs.color.toLowerCase() : PALETTE[curves.length % PALETTE.length];
		if (mode === "xy") {
			const x = ref(c.attrs.curve_x), y = ref(c.attrs.curve_y);
			if (x && y)
				curves.push({ x, y, color, hidden: false });
		} else {
			const r = ref(c.attrs.name);
			if (r)
				curves.push({ ...r, color, transform: { kind: "none" }, hidden: false });
		}
	}
	// a fixed value range ("limitY" with min / max)
	const limit = child(plotElement, "limitY");
	const lo = Number(limit?.attrs.min), hi = Number(limit?.attrs.max);
	const y = limit && Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [lo, hi] : null;
	return { kind: "plot", id: uid("plot"), mode, curves, y, legend: "right" };
}

// a DockSplitter / DockArea element -> a layout node (null when it holds no plot)
function nodeFrom(element, topics, typeOf, depth = 0) {
	if (depth > 32)
		return null;
	if (element.tag === "DockArea") {
		const plot = child(element, "plot");
		return plot ? plotFrom(plot, topics, typeOf) : { kind: "plot", id: uid("plot"), mode: "time", curves: [], y: null, legend: "right" };
	}
	if (element.tag === "DockSplitter") {
		const parts = element.children.map((c) => nodeFrom(c, topics, typeOf, depth + 1)).filter(Boolean);
		if (parts.length === 0)
			return null;
		if (parts.length === 1)
			return parts[0];
		const raw = String(element.attrs.sizes ?? "").split(";").map(Number);
		const sizes = raw.length === parts.length && raw.every((s) => Number.isFinite(s) && s > 0) ? raw : parts.map(() => 1);
		const total = sizes.reduce((a, b) => a + b, 0);
		// "-": a horizontal line between them, so they are stacked; "|": side by side
		return { kind: "split", id: uid("split"), direction: element.attrs.orientation === "|" ? "row" : "column", children: parts, sizes: sizes.map((s) => s / total) };
	}
	for (const c of element.children) {
		const node = nodeFrom(c, topics, typeOf, depth + 1);
		if (node)
			return node;
	}
	return null;
}

// text of a PlotJuggler layout -> { tabs: [{ id, name, root }], curves: n } or throws with a reason.
// topics: [[topic, type]] on the ROS graph, to find where each curve's topic name ends.
export function importPlotJuggler(text, topics = []) {
	const doc = parseXml(String(text));
	const root = child(doc, "root");
	if (!root)
		throw new Error("This is not a PlotJuggler layout: there is no <root> element.");
	const types = new Map(topics);
	const names = [...types.keys()];
	const typeOf = (topic) => types.get(topic) ?? "";
	const tabs = [];
	for (const widget of children(root, "tabbed_widget")) {
		for (const tab of children(widget, "Tab")) {
			const container = child(tab, "Container") ?? tab;
			const node = nodeFrom(container, names, typeOf);
			if (node)
				tabs.push({ id: uid("tab"), name: (tab.attrs.tab_name || `Tab ${tabs.length + 1}`).slice(0, 60), root: node });
		}
	}
	if (tabs.length === 0)
		throw new Error("The PlotJuggler layout has no tabs with plots.");
	let curves = 0;
	const count = (node) => {
		if (node.kind === "plot")
			curves += node.curves.length;
		else
			node.children.forEach(count);
	};
	tabs.forEach((t) => count(t.root));
	return { tabs, curves };
}
