// One plot of a plot panel: a canvas with its axes and curves, a legend, and a slim header with
// its actions. Time plots in a panel share one time axis (following the newest data, or paused
// on a range) and one hover cursor, as in PlotJuggler. XY plots draw one series against another
// over the same time range.
//
// Mouse: drag = box zoom (a flat box zooms time only), Ctrl / middle / right drag = pan,
// wheel = zoom time (Shift: the value axis), double-click = fit. Touch: drag = pan, double tap = fit.

import { niceTicks, formatTick, formatValue, decimate, paddedRange } from './chart_math.js';
import { applyTransform, transformTag, TRANSFORMS } from './transforms.js';
import { refsOf } from './layout.js';

export const SERIES_MIME = "application/x-vizanti-series";

const MARGIN = { top: 6, right: 10, bottom: 20 };
const FONT = "11px system-ui, sans-serif";
const TEXT = "#8d9aab";
const GRID = "rgba(141, 154, 171, 0.16)";
const AXIS = "rgba(141, 154, 171, 0.45)";
const CURSOR = "rgba(223, 230, 238, 0.55)";

const el = (tag, className, text) => {
	const e = document.createElement(tag);
	if (className)
		e.className = className;
	if (text !== undefined)
		e.textContent = text;
	return e;
};

function button(text, title, onClick) {
	const b = el("button", "plot_icon_button", text);
	b.type = "button";
	b.title = title;
	b.setAttribute("aria-label", title);
	b.addEventListener("click", (event) => {
		event.stopPropagation();
		onClick(event);
	});
	return b;
}

export const refName = (ref) => `${ref.topic}/${ref.field}`;

// "…/position/x" for a long name, keeping its end
const shortName = (name, max = 48) => (name.length <= max ? name : `…${name.slice(name.length - max + 1)}`);

export class PlotView {

	// panel: the PlotPanel (store, shared axis and hover, layout edits); node: this plot's layout node
	constructor(panel, node) {
		this.panel = panel;
		this.node = node;
		this.pendingX = null;   // XY: the X field dropped first, waiting for its Y
		this.xyView = null;     // XY: [x0, x1, y0, y1] after a zoom, else fitted to the data
		this.dirty = true;
		this.drag = null;
		this.lastFrame = null;  // what was drawn: mapping and the curves' points, for hover

		this.element = el("div", "plot_cell");
		this.element.dataset.plotId = node.id;
		this.header = el("div", "plot_cell_header");
		this.title = el("span", "plot_cell_title");
		this.header.append(this.title,
			this.modeButton = button("XY", "Switch between time series and XY", () => this.panel.setPlotMode(this.node.id, this.node.mode === "xy" ? "time" : "xy")),
			button("+", "Add the fields selected in the list", () => this.panel.addSelectedTo(this.node.id)),
			button("☷", "Legend: right, left or hidden", () => this.panel.cycleLegend(this.node.id)),
			button("◫", "Split: new plot to the right", () => this.panel.splitPlot(this.node.id, "row")),
			button("⊟", "Split: new plot below", () => this.panel.splitPlot(this.node.id, "column")),
			button("⌫", "Remove all curves", () => this.panel.clearPlot(this.node.id)),
			button("✕", "Close this plot", () => this.panel.closePlot(this.node.id)));

		this.body = el("div", "plot_cell_body");
		this.canvas = el("canvas", "plot_canvas");
		this.legend = el("div", "plot_legend");
		this.hint = el("div", "plot_hint");
		this.menu = null;
		this.body.append(this.canvas, this.legend, this.hint);
		this.element.append(this.header, this.body);
		this.ctx2d = this.canvas.getContext("2d");

		this.resizeObserver = new ResizeObserver(() => { this.dirty = true; this.panel.requestFrame(); });
		this.resizeObserver.observe(this.body);
		this._wireDrop();
		this._wirePointer();
		this.update(node);
	}

	update(node) {
		const modeChanged = node.mode !== this.node.mode;
		this.node = node;
		if (modeChanged) {
			this.pendingX = null;
			this.xyView = null;
		}
		this.modeButton.textContent = node.mode === "xy" ? "t" : "XY";
		this.modeButton.title = node.mode === "xy" ? "Switch to a time series plot" : "Switch to an XY plot (one field against another)";
		this.title.textContent = node.mode === "xy" ? "XY" : "";
		this.legend.classList.toggle("plot_legend_left", node.legend === "left");
		this.legend.hidden = node.legend === "hidden";
		this._buildLegend();
		this.dirty = true;
	}

	setActive(active) {
		this.element.classList.toggle("plot_cell_active", active);
	}

	destroy() {
		this.resizeObserver.disconnect();
		this._closeMenu();
		this.element.remove();
	}

	// ---- legend ----

	_buildLegend() {
		this.legend.replaceChildren();
		this.legendValues = [];
		this.node.curves.forEach((curve, index) => {
			const row = el("div", "plot_legend_row");
			row.classList.toggle("plot_legend_hidden", !!curve.hidden);
			const swatch = el("span", "plot_swatch");
			swatch.style.background = curve.color;
			const name = "x" in curve ? `${refName(curve.y)} vs ${refName(curve.x)}` : refName(curve);
			const tag = "x" in curve ? "" : transformTag(curve.transform);
			const label = el("span", "plot_legend_name", shortName(name) + (tag ? ` [${tag}]` : ""));
			label.title = `${name}${tag ? ` [${tag}]` : ""}\nClick to show or hide; ⋯ for colour, transform, remove.`;
			const value = el("span", "plot_legend_value");
			const more = el("button", "plot_legend_more", "⋯");
			more.type = "button";
			more.title = "Colour, transform, remove";
			row.append(swatch, label, value, more);
			label.addEventListener("click", () => this.panel.updateCurve(this.node.id, index, { hidden: !curve.hidden }));
			swatch.addEventListener("click", () => this.panel.updateCurve(this.node.id, index, { hidden: !curve.hidden }));
			more.addEventListener("click", (event) => {
				event.stopPropagation();
				this._openMenu(index, more);
			});
			row.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				this._openMenu(index, more);
			});
			this.legend.appendChild(row);
			this.legendValues.push(value);
		});
		if (this.node.curves.length === 0) {
			this.hint.textContent = this.node.mode === "xy"
				? (this.pendingX ? `X: ${refName(this.pendingX)}. Now drop the Y field.` : "Drop two fields: X first, then Y (or both at once).")
				: "Drag fields here from the list (or select them and press +).";
		} else {
			this.hint.textContent = this.pendingX ? `X: ${refName(this.pendingX)}. Now drop the Y field.` : "";
		}
		this.hint.hidden = this.hint.textContent === "";
	}

	_openMenu(index, anchor) {
		this._closeMenu();
		const curve = this.node.curves[index];
		if (!curve)
			return;
		const menu = el("div", "plot_menu");
		menu.addEventListener("pointerdown", (event) => event.stopPropagation());
		const colorRow = el("label", "plot_menu_row", "Colour ");
		const color = el("input");
		color.type = "color";
		color.value = curve.color;
		color.addEventListener("input", () => this.panel.updateCurve(this.node.id, index, { color: color.value }, { rebuild: false }));
		colorRow.appendChild(color);
		menu.appendChild(colorRow);
		if (!("x" in curve)) {
			const transform = { ...curve.transform };
			const kindRow = el("label", "plot_menu_row", "Transform ");
			const kind = el("select");
			for (const [key, def] of Object.entries(TRANSFORMS)) {
				const option = el("option", "", def.label);
				option.value = key;
				kind.appendChild(option);
			}
			kind.value = transform.kind;
			kindRow.appendChild(kind);
			const params = el("div", "plot_menu_params");
			const paintParams = () => {
				params.replaceChildren();
				for (const [key, fallback] of Object.entries(TRANSFORMS[transform.kind].params)) {
					const row = el("label", "plot_menu_row", `${key === "samples" ? "Samples" : key === "gain" ? "Gain" : "Offset"} `);
					const input = el("input");
					input.type = "number";
					input.step = "any";
					input.value = String(transform[key] ?? fallback);
					input.addEventListener("change", () => {
						transform[key] = Number(input.value);
						this.panel.updateCurve(this.node.id, index, { transform: { ...transform } });
					});
					row.appendChild(input);
					params.appendChild(row);
				}
			};
			kind.addEventListener("change", () => {
				for (const key of Object.keys(transform))
					delete transform[key];
				Object.assign(transform, { kind: kind.value }, TRANSFORMS[kind.value].params);
				paintParams();
				this.panel.updateCurve(this.node.id, index, { transform: { ...transform } });
			});
			paintParams();
			menu.append(kindRow, params);
		}
		const actions = el("div", "plot_menu_row");
		const remove = el("button", "", "Remove");
		remove.type = "button";
		remove.addEventListener("click", () => {
			this._closeMenu();
			this.panel.removeCurve(this.node.id, index);
		});
		const done = el("button", "", "Close");
		done.type = "button";
		done.addEventListener("click", () => this._closeMenu());
		actions.append(remove, done);
		menu.appendChild(actions);
		this.body.appendChild(menu);
		const anchorRect = anchor.getBoundingClientRect();
		const bodyRect = this.body.getBoundingClientRect();
		menu.style.left = `${Math.max(0, Math.min(bodyRect.width - 220, anchorRect.left - bodyRect.left))}px`;
		menu.style.top = `${anchorRect.bottom - bodyRect.top + 2}px`;
		this.menu = menu;
		this._menuAway = (event) => {
			if (!menu.contains(event.target))
				this._closeMenu();
		};
		setTimeout(() => document.addEventListener("pointerdown", this._menuAway, true), 0);
	}

	_closeMenu() {
		if (this._menuAway)
			document.removeEventListener("pointerdown", this._menuAway, true);
		this._menuAway = null;
		this.menu?.remove();
		this.menu = null;
	}

	// ---- dropping fields ----

	_wireDrop() {
		const accepts = (event) => [...(event.dataTransfer?.types ?? [])].includes(SERIES_MIME);
		this.element.addEventListener("dragover", (event) => {
			if (!accepts(event))
				return;
			event.preventDefault();
			event.dataTransfer.dropEffect = "copy";
			this.element.classList.add("plot_drop_target");
		});
		this.element.addEventListener("dragleave", (event) => {
			if (!this.element.contains(event.relatedTarget))
				this.element.classList.remove("plot_drop_target");
		});
		this.element.addEventListener("drop", (event) => {
			this.element.classList.remove("plot_drop_target");
			if (!accepts(event))
				return;
			event.preventDefault();
			let refs = [];
			try {
				refs = JSON.parse(event.dataTransfer.getData(SERIES_MIME));
			} catch (e) {
				return;
			}
			this.addRefs(Array.isArray(refs) ? refs : []);
		});
		this.element.addEventListener("pointerdown", () => this.panel.setActivePlot(this.node.id), true);
	}

	// adds fields: as time curves, or in an XY plot as (X, Y) pairs, an odd one waiting for its partner
	addRefs(refs) {
		const valid = refs.filter((r) => r && typeof r.topic === "string" && typeof r.field === "string");
		if (valid.length === 0)
			return;
		if (this.node.mode !== "xy") {
			this.panel.addCurves(this.node.id, valid);
			return;
		}
		const queue = this.pendingX ? [this.pendingX, ...valid] : valid;
		this.pendingX = null;
		const pairs = [];
		for (let i = 0; i + 1 < queue.length; i += 2)
			pairs.push([queue[i], queue[i + 1]]);
		if (queue.length % 2 === 1)
			this.pendingX = queue[queue.length - 1];
		if (pairs.length)
			this.panel.addXYCurves(this.node.id, pairs);
		else
			this._buildLegend();
	}

	// ---- pointer: zoom, pan, hover ----

	_wirePointer() {
		const canvas = this.canvas;
		canvas.addEventListener("contextmenu", (event) => event.preventDefault());
		canvas.addEventListener("pointerdown", (event) => {
			const frame = this.lastFrame;
			if (!frame)
				return;
			const p = this._local(event);
			const pan = event.pointerType === "touch" || event.button === 1 || event.button === 2 || event.ctrlKey || event.metaKey;
			if (event.button !== 0 && !pan)
				return;
			canvas.setPointerCapture(event.pointerId);
			this.drag = { kind: pan ? "pan" : "box", start: p, now: p, frame, pointerId: event.pointerId };
			event.preventDefault();
		});
		canvas.addEventListener("pointermove", (event) => {
			const p = this._local(event);
			if (this.drag) {
				this.drag.now = p;
				if (this.drag.kind === "pan")
					this._applyPan();
				this.dirty = true;
				this.panel.requestFrame();
				return;
			}
			this._hoverAt(p);
		});
		const end = (event) => {
			if (!this.drag || event.pointerId !== this.drag.pointerId)
				return;
			const drag = this.drag;
			this.drag = null;
			if (drag.kind === "box")
				this._applyBox(drag);
			else
				this.panel.commitView(); // a pan of the value axis is saved once, at the end
			this.dirty = true;
			this.panel.requestFrame();
		};
		canvas.addEventListener("pointerup", end);
		canvas.addEventListener("pointercancel", end);
		canvas.addEventListener("pointerleave", () => {
			if (!this.drag)
				this.panel.setHover(null);
		});
		canvas.addEventListener("dblclick", () => this.fit());
		canvas.addEventListener("wheel", (event) => {
			const frame = this.lastFrame;
			if (!frame)
				return;
			event.preventDefault();
			const factor = Math.exp(Math.sign(event.deltaY) * Math.min(0.5, Math.abs(event.deltaY) / 300));
			const p = this._local(event);
			if (event.shiftKey)
				this._zoomY(frame, p, factor);
			else
				this._zoomX(frame, p, factor);
		}, { passive: false });
	}

	_local(event) {
		const rect = this.canvas.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	_hoverAt(p) {
		const frame = this.lastFrame;
		if (!frame || p.x < frame.left || p.x > frame.left + frame.width || p.y < frame.top || p.y > frame.top + frame.height) {
			this.panel.setHover(null);
			return;
		}
		if (this.node.mode === "xy") {
			// the time of the nearest drawn point
			let best = null, bestD = 24 * 24;
			for (const c of frame.curves) {
				for (let i = 0; i < c.count; i++) {
					const dx = frame.px(c.xs[i]) - p.x, dy = frame.py(c.ys[i]) - p.y;
					const d = dx * dx + dy * dy;
					if (d < bestD) {
						bestD = d;
						best = c.ts[i];
					}
				}
			}
			this.panel.setHover(best);
			return;
		}
		this.panel.setHover(frame.ix(p.x));
	}

	_applyBox(drag) {
		const { frame, start, now } = drag;
		const dx = Math.abs(now.x - start.x), dy = Math.abs(now.y - start.y);
		if (dx < 5 && dy < 5)
			return;
		const x0 = frame.ix(Math.min(start.x, now.x)), x1 = frame.ix(Math.max(start.x, now.x));
		const y0 = frame.iy(Math.max(start.y, now.y)), y1 = frame.iy(Math.min(start.y, now.y));
		if (this.node.mode === "xy") {
			const view = this.xyView ?? [frame.x0, frame.x1, frame.y0, frame.y1];
			this.xyView = [dx >= 5 ? x0 : view[0], dx >= 5 ? x1 : view[1], dy >= 5 ? y0 : view[2], dy >= 5 ? y1 : view[3]];
			return;
		}
		if (dx >= 5)
			this.panel.setTimeRange([x0, x1]);
		if (dy >= 10 && dy > dx * 0.15)
			this.panel.setYRange(this.node.id, [y0, y1]);
	}

	_applyPan() {
		const { frame, start, now } = this.drag;
		const dxData = (now.x - start.x) / frame.width * (frame.x1 - frame.x0);
		const dyData = (now.y - start.y) / frame.height * (frame.y1 - frame.y0);
		if (this.node.mode === "xy") {
			this.xyView = [frame.x0 - dxData, frame.x1 - dxData, frame.y0 + dyData, frame.y1 + dyData];
			return;
		}
		this.panel.setTimeRange([frame.x0 - dxData, frame.x1 - dxData]);
		if (Math.abs(now.y - start.y) > 3)
			this.panel.setYRange(this.node.id, [frame.y0 + dyData, frame.y1 + dyData], { save: false });
	}

	_zoomX(frame, p, factor) {
		const at = frame.ix(Math.max(frame.left, Math.min(frame.left + frame.width, p.x)));
		if (this.node.mode === "xy") {
			const v = this.xyView ?? [frame.x0, frame.x1, frame.y0, frame.y1];
			const ay = frame.iy(p.y);
			this.xyView = [at - (at - v[0]) * factor, at + (v[1] - at) * factor, ay - (ay - v[2]) * factor, ay + (v[3] - ay) * factor];
			this.dirty = true;
			this.panel.requestFrame();
			return;
		}
		this.panel.zoomTime(at, factor);
	}

	_zoomY(frame, p, factor) {
		const at = frame.iy(p.y);
		if (this.node.mode === "xy") {
			const v = this.xyView ?? [frame.x0, frame.x1, frame.y0, frame.y1];
			this.xyView = [v[0], v[1], at - (at - v[2]) * factor, at + (v[3] - at) * factor];
			this.dirty = true;
			this.panel.requestFrame();
			return;
		}
		this.panel.setYRange(this.node.id, [at - (at - frame.y0) * factor, at + (frame.y1 - at) * factor]);
	}

	// double-click: the value axis fits the data again; a paused time axis shows all the data
	fit() {
		if (this.node.mode === "xy") {
			this.xyView = null;
			this.dirty = true;
			this.panel.requestFrame();
			return;
		}
		this.panel.setYRange(this.node.id, null);
		if (!this.panel.axis.follow)
			this.panel.fitTime(this.node.id);
	}

	// the [first, last] sample time of this plot's curves, or null
	dataExtent() {
		let lo = Infinity, hi = -Infinity;
		for (const curve of this.node.curves) {
			for (const ref of refsOf(curve)) {
				const series = this.panel.store.series(ref.topic, ref.field);
				if (series?.length) {
					lo = Math.min(lo, series.firstTime);
					hi = Math.max(hi, series.lastTime);
				}
			}
		}
		return lo < hi ? [lo, hi] : null;
	}

	// ---- drawing ----

	// [{ curve, index, xs, ys, ts?, count, color }] for the visible range [t0, t1]
	_collect(t0, t1, pixels) {
		const store = this.panel.store;
		const out = [];
		this.node.curves.forEach((curve, index) => {
			if (curve.hidden)
				return;
			if ("x" in curve) {
				const sx = store.series(curve.x.topic, curve.x.field);
				const sy = store.series(curve.y.topic, curve.y.field);
				if (!sx?.length || !sy?.length)
					return;
				const i0 = sy.lowerBound(t0), i1 = sy.lowerBound(t1 + 1e-9);
				// at most ~4 points per pixel of width, evenly spaced through the samples
				const n = i1 - i0;
				const step = Math.max(1, Math.floor(n / Math.max(1, pixels * 4)));
				const xs = [], ys = [], ts = [];
				for (let i = i0; i < i1; i += step) {
					const t = sy.timeAt(i);
					const j = sx.indexAtOrBefore(t);
					if (j < 0)
						continue;
					xs.push(sx.valueAt(j));
					ys.push(sy.valueAt(i));
					ts.push(t);
				}
				if (i1 - 1 >= i0 && ts[ts.length - 1] !== sy.timeAt(i1 - 1)) {
					const j = sx.indexAtOrBefore(sy.timeAt(i1 - 1));
					if (j >= 0) {
						xs.push(sx.valueAt(j));
						ys.push(sy.valueAt(i1 - 1));
						ts.push(sy.timeAt(i1 - 1));
					}
				}
				out.push({ curve, index, xs, ys, ts, count: xs.length, color: curve.color });
				return;
			}
			const series = store.series(curve.topic, curve.field);
			if (!series?.length)
				return;
			// one sample either side of the range, so the line reaches the edges
			const i0 = Math.max(0, series.lowerBound(t0) - 1);
			const i1 = Math.min(series.length, series.lowerBound(t1) + 1);
			if (i1 <= i0)
				return;
			const times = series.times.subarray(series.start + i0, series.start + i1);
			const values = curve.transform?.kind && curve.transform.kind !== "none"
				? applyTransform(series, i0, i1, curve.transform)
				: series.values.subarray(series.start + i0, series.start + i1);
			const d = decimate(times, values, t0, t1, pixels);
			out.push({ curve, index, xs: d.xs, ys: d.ys, count: d.count, color: curve.color, series });
		});
		return out;
	}

	draw() {
		const rect = this.body.getBoundingClientRect();
		const width = Math.floor(rect.width), height = Math.floor(rect.height);
		if (width < 20 || height < 20) {
			this.lastFrame = null;
			return;
		}
		const dpr = window.devicePixelRatio || 1;
		if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
			this.canvas.width = Math.round(width * dpr);
			this.canvas.height = Math.round(height * dpr);
			this.canvas.style.width = `${width}px`;
			this.canvas.style.height = `${height}px`;
		}
		const ctx = this.ctx2d;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, width, height);
		ctx.font = FONT;

		const [t0, t1] = this.panel.timeRange();
		const xy = this.node.mode === "xy";
		const plotWidthGuess = Math.max(10, width - 60);
		const curves = this._collect(t0, t1, plotWidthGuess);

		// ranges: x is time (or the X values), y the values, fitted unless zoomed
		let x0 = t0, x1 = t1, y0, y1;
		const fit = (key, from, to) => {
			let lo = Infinity, hi = -Infinity;
			for (const c of curves) {
				const arr = c[key];
				for (let i = 0; i < c.count; i++) {
					if (!xy && (c.xs[i] < from || c.xs[i] > to))
						continue;
					const v = arr[i];
					if (v < lo) lo = v;
					if (v > hi) hi = v;
				}
			}
			return paddedRange(lo, hi);
		};
		if (xy) {
			const fx = fit("xs") ?? [-1, 1];
			const fy = fit("ys") ?? [-1, 1];
			[x0, x1, y0, y1] = this.xyView ?? [fx[0], fx[1], fy[0], fy[1]];
		} else if (this.node.y) {
			[y0, y1] = this.node.y;
		} else {
			[y0, y1] = fit("ys", t0, t1) ?? [-1, 1];
		}

		// y labels decide the left margin
		const yTicks = niceTicks(y0, y1, Math.max(2, Math.floor(height / 40)));
		const yLabels = yTicks.ticks.map((v) => formatTick(v, yTicks.step));
		const left = Math.max(34, Math.ceil(Math.max(0, ...yLabels.map((l) => ctx.measureText(l).width))) + 10);
		const top = MARGIN.top, plotW = Math.max(1, width - left - MARGIN.right), plotH = Math.max(1, height - top - MARGIN.bottom);
		const px = (x) => left + (x - x0) / (x1 - x0) * plotW;
		const py = (y) => top + (1 - (y - y0) / (y1 - y0)) * plotH;
		const ix = (p) => x0 + (p - left) / plotW * (x1 - x0);
		const iy = (p) => y0 + (1 - (p - top) / plotH) * (y1 - y0);

		// grid and labels
		// time is shown in seconds since the first sample (before there is one: back from now)
		const timeBase = Number.isFinite(this.panel.store.t0) ? this.panel.store.t0 : t1;
		const xTicks = xy ? niceTicks(x0, x1, Math.max(2, Math.floor(plotW / 80))) : niceTicks(x0 - timeBase, x1 - timeBase, Math.max(2, Math.floor(plotW / 80)));
		ctx.lineWidth = 1;
		ctx.strokeStyle = GRID;
		ctx.fillStyle = TEXT;
		ctx.textBaseline = "middle";
		ctx.textAlign = "right";
		ctx.beginPath();
		yTicks.ticks.forEach((v, i) => {
			const y = Math.round(py(v)) + 0.5;
			ctx.moveTo(left, y);
			ctx.lineTo(left + plotW, y);
			ctx.fillText(yLabels[i], left - 5, y);
		});
		ctx.textAlign = "center";
		ctx.textBaseline = "top";
		for (const v of xTicks.ticks) {
			const x = Math.round(px(xy ? v : v + timeBase)) + 0.5;
			ctx.moveTo(x, top);
			ctx.lineTo(x, top + plotH);
			const label = formatTick(v, xTicks.step);
			// labels that would run into the unit at the right edge are left out
			if (xy || x + ctx.measureText(label).width / 2 < width - 12)
				ctx.fillText(label, x, top + plotH + 4);
		}
		ctx.stroke();
		ctx.strokeStyle = AXIS;
		ctx.strokeRect(left + 0.5, top + 0.5, plotW - 1, plotH - 1);
		if (!xy) {
			ctx.textAlign = "right";
			ctx.fillText("s", width - 2, top + plotH + 4);
		}

		// curves, clipped to the plot area
		ctx.save();
		ctx.beginPath();
		ctx.rect(left, top, plotW, plotH);
		ctx.clip();
		ctx.lineJoin = "round";
		for (const c of curves) {
			ctx.strokeStyle = c.color;
			ctx.fillStyle = c.color;
			ctx.lineWidth = 1.5;
			ctx.beginPath();
			let pen = false;
			let visible = 0;
			for (let i = 0; i < c.count; i++) {
				const yv = c.ys[i];
				const xv = c.xs[i];
				if (!Number.isFinite(yv) || !Number.isFinite(xv)) {
					pen = false;
					continue;
				}
				const x = px(xv), y = py(yv);
				if (pen)
					ctx.lineTo(x, y);
				else
					ctx.moveTo(x, y);
				pen = true;
				visible++;
			}
			ctx.stroke();
			// sparse data: show the samples too
			if (visible > 0 && visible < plotW / 8) {
				for (let i = 0; i < c.count; i++) {
					if (Number.isFinite(c.ys[i]) && Number.isFinite(c.xs[i])) {
						ctx.beginPath();
						ctx.arc(px(c.xs[i]), py(c.ys[i]), 2, 0, Math.PI * 2);
						ctx.fill();
					}
				}
			}
			if (xy && c.count > 0) {
				// the newest point, bigger
				ctx.beginPath();
				ctx.arc(px(c.xs[c.count - 1]), py(c.ys[c.count - 1]), 4, 0, Math.PI * 2);
				ctx.fill();
			}
		}

		// the shared cursor, and the values under it
		const hover = this.panel.hover;
		const values = [];
		if (hover !== null && hover >= x0 - (xy ? Infinity : 0)) {
			if (!xy) {
				const x = Math.round(px(hover)) + 0.5;
				if (x >= left && x <= left + plotW) {
					ctx.strokeStyle = CURSOR;
					ctx.lineWidth = 1;
					ctx.beginPath();
					ctx.moveTo(x, top);
					ctx.lineTo(x, top + plotH);
					ctx.stroke();
				}
			}
		}
		for (const c of curves) {
			let value = NaN, at = null;
			if (xy) {
				const k = hover === null ? c.count - 1 : nearestIndex(c.ts, hover);
				if (k >= 0) {
					value = c.ys[k];
					at = { x: px(c.xs[k]), y: py(c.ys[k]) };
					values[c.index] = `${formatValue(c.xs[k])}, ${formatValue(c.ys[k])}`;
				}
			} else {
				const s = c.series;
				const t = hover ?? Math.min(t1, s.lastTime);
				const i = s.indexAtOrBefore(t);
				if (i >= 0) {
					value = c.curve.transform?.kind && c.curve.transform.kind !== "none" ? applyTransform(s, i, i + 1, c.curve.transform)[0] : s.valueAt(i);
					if (hover !== null)
						at = { x: px(hover), y: py(value) };
				}
				values[c.index] = formatValue(value);
			}
			if (at && Number.isFinite(value) && hover !== null) {
				ctx.fillStyle = c.color;
				ctx.beginPath();
				ctx.arc(at.x, at.y, 3.5, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		ctx.restore();

		// the zoom box being dragged
		if (this.drag?.kind === "box") {
			const { start, now } = this.drag;
			ctx.fillStyle = "rgba(108, 142, 191, 0.18)";
			ctx.strokeStyle = "#6c8ebf";
			const bx = Math.min(start.x, now.x), by = Math.min(start.y, now.y);
			ctx.fillRect(bx, by, Math.abs(now.x - start.x), Math.abs(now.y - start.y));
			ctx.strokeRect(bx + 0.5, by + 0.5, Math.abs(now.x - start.x), Math.abs(now.y - start.y));
		}

		// legend values (curves with no data show a dash)
		this.node.curves.forEach((curve, index) => {
			const cell = this.legendValues[index];
			if (cell) {
				const text = values[index] ?? (curve.hidden ? "" : "no data");
				if (cell.textContent !== text)
					cell.textContent = text;
			}
		});

		this.lastFrame = { left, top, width: plotW, height: plotH, x0, x1, y0, y1, px, py, ix, iy, curves };
		this.dirty = false;
	}
}

// the index of the time in a sorted array nearest to t, or -1 for an empty one
function nearestIndex(times, t) {
	let lo = 0, hi = times.length - 1;
	if (hi < 0)
		return -1;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (times[mid] < t)
			lo = mid + 1;
		else
			hi = mid;
	}
	if (lo > 0 && Math.abs(times[lo - 1] - t) < Math.abs(times[lo] - t))
		return lo - 1;
	return lo;
}
