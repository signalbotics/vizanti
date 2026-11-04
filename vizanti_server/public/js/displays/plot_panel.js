import { PanelPlugin, WIDGET_PROPERTIES } from '../core/panel.js';
import { plotStoreFor } from '../plot/store.js';
import * as L from '../plot/layout.js';
import { PlotView, refName } from '../plot/plot_view.js';
import { SeriesBrowser } from '../plot/series_browser.js';
import { applyTransform } from '../plot/transforms.js';
import { toCsv } from '../plot/csv.js';
import { importPlotJuggler } from '../plot/plotjuggler_import.js';

const FRAME_MS = 33;        // at most ~30 redraws a second
const SAVE_DELAY_MS = 400;  // layout edits are saved once they settle (a drag, a wheel)

const el = (tag, className, text) => {
	const e = document.createElement(tag);
	if (className)
		e.className = className;
	if (text !== undefined)
		e.textContent = text;
	return e;
};

function labelled(text, input, title) {
	const label = el("label", "plot_toolbar_field");
	label.title = title;
	label.append(el("span", "", text), input);
	return label;
}

function numberInput(value, min, max, step, onChange) {
	const input = el("input");
	input.type = "number";
	input.min = String(min);
	input.max = String(max);
	input.step = String(step);
	input.value = String(value);
	input.addEventListener("change", () => {
		const v = Number(input.value);
		if (Number.isFinite(v) && v >= min && v <= max)
			onChange(v);
		else
			input.value = String(value);
	});
	return input;
}

// PlotJuggler-style plotting of any numeric field of any topic: tabs, each split into plots;
// time series sharing one time axis, or XY plots; a series list to drag fields from.
export class PlotPanel extends PanelPlugin {
	static type = "plot";
	static label = "Plot";
	static icon = "assets/plot.svg";
	static category = "Data";
	static description = "Time series and XY plots of any numeric field of any topic, as in PlotJuggler: tabs, split plots, a shared zoomable time axis, transforms, CSV export.";
	static panelDirection = "tab"; // a tab beside the 3D view, with the whole view area to itself

	static properties = {
		plot: { type: "object", default: null, hidden: true }, // see plot/layout.js
		...WIDGET_PROPERTIES,
	};

	onCreate() {
		this.state = L.normalizeState(this.props.plot);
		this.store = plotStoreFor(this.ctx);
		this.store.setSettings({ buffer: this.state.buffer, timeSource: this.state.timeSource, maxArray: this.state.maxArray });
		this.axis = { follow: true, window: this.state.window, range: null }; // range: [t0, t1] while paused
		this.hover = null;
		this.activePlot = null;
		this.views = new Map();  // plot id -> PlotView (of the shown tab)
		this._savedState = this.props.plot;
		this._offStore = this.store.on((event) => this._onStore(event));
		this.store.want(this.id, L.topicsIn(this.state));
	}

	onDestroy() {
		clearTimeout(this._saveTimer);
		this._saveNow();
		this._offStore?.();
		this.store.release(this.id);
		cancelAnimationFrame(this._raf);
		this._raf = null;
		for (const view of this.views.values())
			view.destroy();
		this.views.clear();
		this.browser?.destroy();
		this._narrowObserver?.disconnect();
	}

	// the layout changed from outside (an imported layout, another tab of the shell): take it
	onPropertyChange(key, value) {
		if (key !== "plot" || value === this._savedState)
			return;
		this._savedState = value;
		this.state = L.normalizeState(value);
		this.axis.window = this.state.window;
		this.store.setSettings({ buffer: this.state.buffer, timeSource: this.state.timeSource, maxArray: this.state.maxArray });
		this.store.want(this.id, L.topicsIn(this.state));
		this._renderAll();
	}

	_onStore(event) {
		if (event.kind === "data") {
			this.requestFrame(); // the loop stops while nothing changes; new samples restart it
			return;
		}
		if (event.kind === "structure") {
			this.browser?.render();
		} else if (event.kind === "settings") {
			// another plot panel changed the shared buffer: show (and save) the same
			const s = event.settings;
			if (s.buffer !== this.state.buffer || s.timeSource !== this.state.timeSource || s.maxArray !== this.state.maxArray) {
				this.state = { ...this.state, buffer: s.buffer, timeSource: s.timeSource, maxArray: s.maxArray };
				this._paintToolbar();
				this._scheduleSave();
			}
		}
		this._markAll();
	}

	// ---- state ----

	_edit(fn, { rebuild = true } = {}) {
		const next = fn(this.state);
		if (!next || next === this.state)
			return;
		this.state = next;
		this.store.want(this.id, L.topicsIn(this.state));
		if (rebuild)
			this._renderTabs(), this._renderBody();
		else
			this._syncViews();
		this._scheduleSave();
		this._markAll();
	}

	_editTab(fn, options) {
		this._edit((state) => {
			const tab = state.tabs.find((t) => t.id === state.active);
			const root = fn(tab.root);
			return root === tab.root ? state : L.setTabRoot(state, tab.id, root);
		}, options);
	}

	_scheduleSave() {
		this._unsaved = true;
		clearTimeout(this._saveTimer);
		this._saveTimer = setTimeout(() => this._saveNow(), SAVE_DELAY_MS);
	}

	_saveNow() {
		clearTimeout(this._saveTimer);
		if (!this._unsaved)
			return;
		this._unsaved = false;
		const value = JSON.parse(JSON.stringify(this.state));
		this._savedState = value;
		this.setProp("plot", value);
	}

	get activeTab() {
		return this.state.tabs.find((t) => t.id === this.state.active) ?? this.state.tabs[0];
	}

	// topic -> type of what this panel records (plotted or ticked)
	recordedTopics() {
		return L.topicsIn(this.state);
	}

	plottedTopics() {
		return L.topicsIn({ ...this.state, pinned: [] });
	}

	setPinned(topic, type, on) {
		this._edit((state) => {
			const pinned = state.pinned.filter((p) => p.topic !== topic);
			if (on)
				pinned.push({ topic, type: type ?? "" });
			return { ...state, pinned };
		}, { rebuild: false });
		this.browser?.render();
	}

	// ---- edits the plots ask for ----

	setActivePlot(id) {
		if (this.activePlot === id)
			return;
		this.activePlot = id;
		for (const [plotId, view] of this.views)
			view.setActive(plotId === id && this.views.size > 1);
	}

	addCurves(plotId, refs) {
		this._editTab((root) => refs.reduce((r, ref) => L.addCurve(r, plotId, ref), root), { rebuild: false });
	}

	addXYCurves(plotId, pairs) {
		this._editTab((root) => pairs.reduce((r, [x, y]) => L.addXYCurve(r, plotId, x, y), root), { rebuild: false });
	}

	addSelectedTo(plotId) {
		const refs = this.browser?.selectedRefs() ?? [];
		if (refs.length === 0) {
			this.ctx.notify?.("Select fields in the list first (click them; Ctrl or Shift for several).");
			return;
		}
		this.views.get(plotId)?.addRefs(refs);
		this.browser.clearSelection();
	}

	// double-click in the list: the active plot, else the first one
	addToActive(refs) {
		const id = this.views.has(this.activePlot) ? this.activePlot : L.plotsIn(this.activeTab.root)[0]?.id;
		if (id)
			this.views.get(id)?.addRefs(refs);
	}

	updateCurve(plotId, index, changes) {
		this._editTab((root) => L.updateCurve(root, plotId, index, changes), { rebuild: false });
	}

	removeCurve(plotId, index) {
		this._editTab((root) => L.removeCurve(root, plotId, index), { rebuild: false });
	}

	clearPlot(plotId) {
		const plot = L.findNode(this.activeTab.root, plotId);
		this._editTab((root) => L.mapNode(root, plotId, (p) => ({ ...p, curves: [], y: null })), { rebuild: false });
		if (plot?.mode === "xy")
			this.views.get(plotId).pendingX = null;
	}

	cycleLegend(plotId) {
		this._editTab((root) => L.cycleLegend(root, plotId), { rebuild: false });
	}

	setPlotMode(plotId, mode) {
		this._editTab((root) => L.setMode(root, plotId, mode), { rebuild: false });
	}

	splitPlot(plotId, direction) {
		let created = null;
		this._editTab((root) => {
			const r = L.splitPlot(root, plotId, direction);
			created = r.plot.id;
			return r.root;
		});
		if (created)
			this.setActivePlot(created);
	}

	closePlot(plotId) {
		this._editTab((root) => L.removeNode(root, plotId));
	}

	// ---- the shared time axis and cursor ----

	// [t0, t1] shown now: the last `window` seconds while following, else the paused range
	timeRange() {
		if (!this.axis.follow && this.axis.range)
			return this.axis.range;
		const end = Number.isFinite(this.store.latest) ? this.store.latest : (this.ctx.rosTime?.() ?? Date.now() / 1000);
		return [end - this.axis.window, end];
	}

	setTimeRange(range) {
		if (!(range[1] > range[0]))
			return;
		this.axis.follow = false;
		this.axis.range = range;
		this._paintFollow();
		this._markAll();
	}

	zoomTime(at, factor) {
		if (this.axis.follow) {
			// following: the wheel changes how many seconds are shown
			this.axis.window = Math.min(L.LIMITS.window[1], Math.max(0.05, this.axis.window * factor));
			this.state = { ...this.state, window: Math.max(L.LIMITS.window[0], this.axis.window) };
			if (this.windowInput)
				this.windowInput.value = String(Number(this.axis.window.toPrecision(3)));
			this._scheduleSave();
			this._markAll();
			return;
		}
		const [t0, t1] = this.axis.range;
		this.setTimeRange([at - (at - t0) * factor, at + (t1 - at) * factor]);
	}

	fitTime(plotId) {
		const extent = this.views.get(plotId)?.dataExtent();
		if (extent)
			this.setTimeRange(extent);
	}

	setFollow(follow) {
		if (follow) {
			this.axis.follow = true;
			this.axis.range = null;
		} else {
			this.axis.follow = false;
			this.axis.range = this.timeRange();
		}
		this._paintFollow();
		this._markAll();
	}

	setYRange(plotId, y, { save = true } = {}) {
		if (y && !(y[1] > y[0]))
			return;
		const tab = this.activeTab;
		const root = L.setYRange(tab.root, plotId, y);
		this.state = L.setTabRoot(this.state, tab.id, root);
		const view = this.views.get(plotId);
		if (view) {
			view.node = L.findNode(root, plotId);
			view.dirty = true;
		}
		if (save)
			this._scheduleSave();
		this.requestFrame();
	}

	commitView() {
		this._scheduleSave();
	}

	setHover(t) {
		if (t === this.hover)
			return;
		this.hover = t;
		this._markAll();
	}

	// ---- DOM ----

	buildPanel(container) {
		container.classList.add("plot_widget");
		this.panelRoot = container;
		this.touch = !window.matchMedia?.("(pointer: fine)").matches;

		this.toolbar = el("div", "plot_toolbar");
		this.followButton = el("button", "plot_follow");
		this.followButton.type = "button";
		this.followButton.addEventListener("click", () => this.setFollow(!this.axis.follow));
		this.windowInput = numberInput(this.state.window, L.LIMITS.window[0], L.LIMITS.window[1], "any", (v) => {
			this.axis.window = v;
			this._edit((s) => ({ ...s, window: v }), { rebuild: false });
		});
		this.bufferInput = numberInput(this.state.buffer, L.LIMITS.buffer[0], L.LIMITS.buffer[1], 1, (v) => {
			this._edit((s) => ({ ...s, buffer: v }), { rebuild: false });
			this.store.setSettings({ buffer: v });
		});
		this.timeSource = el("select");
		for (const [value, text] of [["receive", "Receive time"], ["header", "Header stamp"]]) {
			const option = el("option", "", text);
			option.value = value;
			this.timeSource.appendChild(option);
		}
		this.timeSource.addEventListener("change", () => {
			const v = this.timeSource.value;
			this._edit((s) => ({ ...s, timeSource: v }), { rebuild: false });
			this.store.setSettings({ timeSource: v });
		});
		this.maxArrayInput = numberInput(this.state.maxArray, L.LIMITS.maxArray[0], L.LIMITS.maxArray[1], 1, (v) => {
			this._edit((s) => ({ ...s, maxArray: v }), { rebuild: false });
			this.store.setSettings({ maxArray: v });
		});
		const sidebarToggle = el("button", "plot_icon_button", "☰");
		sidebarToggle.type = "button";
		sidebarToggle.title = "Show or hide the series list";
		sidebarToggle.addEventListener("click", () => {
			this._edit((s) => ({ ...s, sidebar: s.sidebar > 0 ? 0 : 240 }), { rebuild: false });
			this._paintSidebar();
		});
		const clear = el("button", "", "Clear");
		clear.type = "button";
		clear.title = "Forget the recorded samples (the plots and fields stay)";
		clear.addEventListener("click", () => this.store.clear());
		const csv = el("button", "", "CSV");
		csv.type = "button";
		csv.title = "Download the curves of this tab as CSV (everything in the buffer, transforms applied)";
		csv.addEventListener("click", () => this.exportCsv());
		const importButton = el("button", "", "Import");
		importButton.type = "button";
		importButton.title = "Add the tabs of a PlotJuggler layout file (.xml)";
		const importFile = el("input");
		importFile.type = "file";
		importFile.accept = ".xml,application/xml,text/xml";
		importFile.hidden = true;
		importButton.addEventListener("click", () => importFile.click());
		importFile.addEventListener("change", async () => {
			const file = importFile.files?.[0];
			importFile.value = "";
			if (file)
				this.importLayout(await file.text(), file.name);
		});
		this.toolbar.append(sidebarToggle, this.followButton,
			labelled("Window", this.windowInput, "Seconds shown while following (the wheel changes it too)"),
			labelled("Buffer", this.bufferInput, "Seconds of samples kept for every recorded field"),
			labelled("Time", this.timeSource, "Receive time, or each message's header stamp (messages without one use the receive time). Changing it starts over."),
			labelled("Max array", this.maxArrayInput, "Arrays longer than this are not split into fields (images, point clouds)"),
			clear, csv, importButton, importFile);

		this.main = el("div", "plot_main");
		this.browser = new SeriesBrowser(this);
		this.sidebarHandle = el("div", "plot_sidebar_handle");
		this.sidebarHandle.title = "Drag to resize the series list";
		this._wireSidebarHandle();
		this.area = el("div", "plot_area");
		this.tabBar = el("div", "plot_tabs");
		this.tabBar.setAttribute("role", "tablist");
		this.tabBody = el("div", "plot_tab_body");
		this.area.append(this.tabBar, this.tabBody);
		this.main.append(this.browser.element, this.sidebarHandle, this.area);
		container.append(this.toolbar, this.main);
		// a narrow panel (a phone, a thin dock column) puts the series list above the plots
		this._narrowObserver = new ResizeObserver(() => {
			container.classList.toggle("plot_narrow", container.getBoundingClientRect().width < 560);
		});
		this._narrowObserver.observe(container);

		this._paintToolbar();
		this._renderAll();
		this.requestFrame();
	}

	attachPanel(host) {
		super.attachPanel(host);
		this.requestFrame();
	}

	_renderAll() {
		if (!this.panelRoot)
			return;
		this._paintToolbar();
		this._paintSidebar();
		this._renderTabs();
		this._renderBody();
		this.browser.render();
	}

	_paintToolbar() {
		if (!this.panelRoot)
			return;
		this._paintFollow();
		if (document.activeElement !== this.windowInput)
			this.windowInput.value = String(Number(this.axis.window.toPrecision(3)));
		this.bufferInput.value = String(this.state.buffer);
		this.timeSource.value = this.state.timeSource;
		this.maxArrayInput.value = String(this.state.maxArray);
	}

	_paintFollow() {
		if (!this.followButton)
			return;
		this.followButton.textContent = this.axis.follow ? "⏸ Pause" : "▶ Follow";
		this.followButton.title = this.axis.follow ? "Stop scrolling (recording goes on); zoom and pan through the buffer"
			: "Follow the newest data again";
		this.followButton.classList.toggle("plot_paused", !this.axis.follow);
	}

	_paintSidebar() {
		const width = this.state.sidebar;
		this.browser.element.hidden = width === 0;
		this.sidebarHandle.hidden = width === 0;
		this.browser.element.style.width = `${width}px`;
	}

	_wireSidebarHandle() {
		this.sidebarHandle.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			this.sidebarHandle.setPointerCapture(event.pointerId);
			const startX = event.clientX;
			const startW = this.browser.element.getBoundingClientRect().width;
			const move = (e) => {
				const w = Math.round(Math.min(L.LIMITS.sidebar[1], Math.max(120, startW + e.clientX - startX)));
				this.browser.element.style.width = `${w}px`;
				this._markAll();
			};
			const up = () => {
				this.sidebarHandle.removeEventListener("pointermove", move);
				this.sidebarHandle.removeEventListener("pointerup", up);
				const w = Math.round(this.browser.element.getBoundingClientRect().width);
				this._edit((s) => ({ ...s, sidebar: w }), { rebuild: false });
			};
			this.sidebarHandle.addEventListener("pointermove", move);
			this.sidebarHandle.addEventListener("pointerup", up);
		});
	}

	_renderTabs() {
		if (!this.tabBar)
			return;
		this.tabBar.replaceChildren();
		this.state.tabs.forEach((tab, index) => {
			const active = tab.id === this.state.active;
			const item = el("div", "plot_tab" + (active ? " plot_tab_on" : ""));
			item.setAttribute("role", "tab");
			item.setAttribute("aria-selected", String(active));
			item.draggable = true;
			const name = el("span", "plot_tab_name", tab.name);
			name.title = "Click to show; double-click to rename; drag to reorder";
			const close = el("button", "plot_tab_close", "×");
			close.type = "button";
			close.title = "Close this tab";
			item.append(name, close);
			item.addEventListener("click", () => {
				if (!active)
					this._edit((s) => ({ ...s, active: tab.id }));
			});
			name.addEventListener("dblclick", (event) => {
				event.stopPropagation();
				this._renameTab(tab, name);
			});
			close.addEventListener("click", (event) => {
				event.stopPropagation();
				const empty = L.plotsIn(tab.root).every((p) => p.curves.length === 0);
				// a tab with curves closes on a second click, so a slip does not lose a layout
				if (!empty && close.dataset.armed !== "1") {
					close.dataset.armed = "1";
					close.textContent = "Close?";
					close.classList.add("plot_tab_close_armed");
					setTimeout(() => {
						if (close.isConnected) {
							close.dataset.armed = "";
							close.textContent = "×";
							close.classList.remove("plot_tab_close_armed");
						}
					}, 3000);
					return;
				}
				this._edit((s) => L.removeTab(s, tab.id));
			});
			item.addEventListener("dragstart", (event) => {
				event.dataTransfer.setData("application/x-vizanti-plot-tab", tab.id);
				event.dataTransfer.effectAllowed = "move";
			});
			item.addEventListener("dragover", (event) => {
				if ([...event.dataTransfer.types].includes("application/x-vizanti-plot-tab"))
					event.preventDefault();
			});
			item.addEventListener("drop", (event) => {
				const id = event.dataTransfer.getData("application/x-vizanti-plot-tab");
				if (id && id !== tab.id) {
					event.preventDefault();
					this._edit((s) => L.moveTab(s, id, index));
				}
			});
			this.tabBar.appendChild(item);
		});
		const add = el("button", "plot_tab_add", "+");
		add.type = "button";
		add.title = "New tab";
		add.addEventListener("click", () => this._edit((s) => L.addTab(s)));
		this.tabBar.appendChild(add);
	}

	_renameTab(tab, nameElement) {
		const input = el("input", "plot_tab_rename");
		input.value = tab.name;
		nameElement.replaceWith(input);
		input.focus();
		input.select();
		let done = false;
		const finish = (save) => {
			if (done)
				return;
			done = true;
			if (save)
				this._edit((s) => L.renameTab(s, tab.id, input.value));
			else
				this._renderTabs();
		};
		input.addEventListener("keydown", (event) => {
			event.stopPropagation(); // the view's shortcuts stay out of it
			if (event.key === "Enter")
				finish(true);
			else if (event.key === "Escape")
				finish(false);
		});
		input.addEventListener("blur", () => finish(true));
	}

	// the split tree of the shown tab; plot views are kept (with their canvas) across rebuilds
	_renderBody() {
		if (!this.tabBody)
			return;
		const root = this.activeTab.root;
		const keep = new Set(L.plotsIn(root).map((p) => p.id));
		for (const [id, view] of this.views) {
			if (!keep.has(id)) {
				view.destroy();
				this.views.delete(id);
			}
		}
		const build = (node) => {
			if (node.kind === "plot") {
				let view = this.views.get(node.id);
				if (view)
					view.update(node);
				else {
					view = new PlotView(this, node);
					this.views.set(node.id, view);
				}
				return view.element;
			}
			const box = el("div", `plot_split plot_split_${node.direction}`);
			node.children.forEach((child, i) => {
				if (i > 0)
					box.appendChild(this._divider(node, i, box));
				const wrap = el("div", "plot_split_child");
				wrap.style.flex = `${node.sizes[i]} 1 0`;
				wrap.appendChild(build(child));
				box.appendChild(wrap);
			});
			return box;
		};
		this.tabBody.replaceChildren(build(root));
		if (!this.views.has(this.activePlot))
			this.activePlot = L.plotsIn(root)[0]?.id ?? null;
		for (const [id, view] of this.views)
			view.setActive(id === this.activePlot && this.views.size > 1);
		this._markAll();
	}

	// views follow the state without rebuilding the DOM (curve edits)
	_syncViews() {
		const root = this.activeTab.root;
		for (const plot of L.plotsIn(root))
			this.views.get(plot.id)?.update(plot);
	}

	_divider(split, index, box) {
		const divider = el("div", `plot_divider plot_divider_${split.direction}`);
		divider.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			divider.setPointerCapture(event.pointerId);
			const children = [...box.children].filter((c) => c.classList.contains("plot_split_child"));
			const horizontal = split.direction === "row";
			const sizes = children.map((c) => (horizontal ? c.getBoundingClientRect().width : c.getBoundingClientRect().height));
			const start = horizontal ? event.clientX : event.clientY;
			const a = index - 1, b = index;
			const total = sizes[a] + sizes[b];
			const move = (e) => {
				const delta = (horizontal ? e.clientX : e.clientY) - start;
				const sa = Math.min(total - 30, Math.max(30, sizes[a] + delta));
				const next = sizes.slice();
				next[a] = sa;
				next[b] = total - sa;
				children.forEach((c, i) => { c.style.flex = `${next[i]} 1 0`; });
				this._current = next;
				this._markAll();
			};
			const up = () => {
				divider.removeEventListener("pointermove", move);
				divider.removeEventListener("pointerup", up);
				if (this._current)
					this._editTab((root) => L.setSizes(root, split.id, this._current), { rebuild: false });
				this._current = null;
			};
			divider.addEventListener("pointermove", move);
			divider.addEventListener("pointerup", up);
		});
		return divider;
	}

	// ---- drawing ----

	_markAll() {
		for (const view of this.views.values())
			view.dirty = true;
		this.requestFrame();
	}

	requestFrame() {
		if (this._raf || !this.panelRoot)
			return;
		this._raf = requestAnimationFrame((now) => this._frame(now));
	}

	_frame(now) {
		this._raf = null;
		if (!this.panelRoot?.isConnected)
			return; // hidden or closed: attachPanel / the next edit starts it again
		if (now - (this._lastDraw ?? 0) >= FRAME_MS) {
			const dataChanged = this.store.version !== this._drawnVersion;
			this._drawnVersion = this.store.version;
			for (const view of this.views.values()) {
				if (view.dirty || dataChanged)
					view.draw();
			}
			this._lastDraw = now;
		}
		// keep going while something is left to draw; an idle panel stops until new samples
		// (the store's "data" event) or an edit start it again
		if (this.store.version !== this._drawnVersion || [...this.views.values()].some((v) => v.dirty))
			this._raf = requestAnimationFrame((t) => this._frame(t));
	}

	// ---- PlotJuggler layouts ----

	// adds the tabs of a PlotJuggler layout; its topics are matched against the ROS graph
	async importLayout(text, fileName = "layout") {
		let graph = { topics: [], types: [] };
		try {
			graph = await this.ctx.listAllTopics();
		} catch (e) {
			// not connected: names are split after their first segment
		}
		let imported;
		try {
			imported = importPlotJuggler(text, (graph.topics ?? []).map((t, i) => [t, graph.types?.[i] ?? ""]));
		} catch (e) {
			this.ctx.notify?.(`${fileName}: ${e.message}`);
			return;
		}
		this._edit((s) => L.normalizeState({ ...s, tabs: [...s.tabs, ...imported.tabs], active: imported.tabs[0].id }));
		this.ctx.notify?.(`Imported ${imported.tabs.length} tab${imported.tabs.length === 1 ? "" : "s"} with ${imported.curves} curve${imported.curves === 1 ? "" : "s"} from ${fileName}.`);
	}

	// ---- CSV ----

	exportCsv() {
		const columns = [];
		for (const plot of L.plotsIn(this.activeTab.root)) {
			for (const curve of plot.curves) {
				for (const ref of L.refsOf(curve)) {
					const series = this.store.series(ref.topic, ref.field);
					if (!series?.length)
						continue;
					const name = refName(ref) + (curve.transform && curve.transform.kind !== "none" ? ` [${curve.transform.kind}]` : "");
					if (columns.some((c) => c.name === name))
						continue;
					const values = curve.transform ? applyTransform(series, 0, series.length, curve.transform) : series.values.slice(series.start, series.start + series.length);
					columns.push({ name, times: series.times.slice(series.start, series.start + series.length), values });
				}
			}
		}
		if (columns.length === 0) {
			this.ctx.notify?.("This tab has no data to export.");
			return;
		}
		const text = toCsv(columns, { t0: Number.isFinite(this.store.t0) ? this.store.t0 : 0 });
		const blob = new Blob([text], { type: "text/csv" });
		const url = URL.createObjectURL(blob);
		const link = document.createElement("a");
		link.href = url;
		link.download = `plot_${this.activeTab.name.replace(/[^\w-]+/g, "_")}_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.csv`;
		link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}
