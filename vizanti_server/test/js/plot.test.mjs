import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flattenMessage, stampSeconds, quaternionToRpy } from '../../public/js/plot/flatten.js';
import { Series } from '../../public/js/plot/series.js';
import { applyTransform, normalizeTransform, transformTag } from '../../public/js/plot/transforms.js';
import { niceTicks, formatTick, formatValue, decimate, paddedRange } from '../../public/js/plot/chart_math.js';
import * as L from '../../public/js/plot/layout.js';
import { toCsv } from '../../public/js/plot/csv.js';
import { PlotStore } from '../../public/js/plot/store.js';
import { importPlotJuggler, splitSeriesName } from '../../public/js/plot/plotjuggler_import.js';
import { fieldTree } from '../../public/js/plot/series_browser.js';

const fields = (msg, options) => Object.fromEntries(flattenMessage(msg, options).values);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

// ---- flatten ----

test('flatten: numbers, booleans, nested fields and time stamps', () => {
	const f = fields({ header: { stamp: { sec: 10, nanosec: 500000000 }, frame_id: 'map' }, twist: { linear: { x: 1.5, y: 0, z: -2 } }, ok: true, label: 'x' });
	assert.deepEqual(f, { 'header/stamp': 10.5, 'twist/linear/x': 1.5, 'twist/linear/y': 0, 'twist/linear/z': -2, ok: 1 });
	assert.equal(stampSeconds({ header: { stamp: { sec: 3, nanosec: 250000000 } } }), 3.25);
	assert.equal(stampSeconds({ header: { stamp: { sec: 0, nanosec: 0 } } }), null);
	assert.equal(stampSeconds({ data: 1 }), null);
	assert.deepEqual(fields({ data: 4 }), { data: 4 });
});

test('flatten: quaternions also give roll, pitch and yaw', () => {
	const s = Math.SQRT1_2;
	const f = fields({ orientation: { x: 0, y: 0, z: s, w: s } });
	close(f['orientation/yaw'], Math.PI / 2);
	close(f['orientation/roll'], 0);
	close(f['orientation/pitch'], 0);
	assert.equal(f['orientation/w'], s);
	const rpy = quaternionToRpy({ x: Math.sin(0.15), y: 0, z: 0, w: Math.cos(0.15) });
	close(rpy.roll, 0.3);
});

test('flatten: JointState arrays are named by joint, as in PlotJuggler', () => {
	const f = fields({ name: ['j1', 'j2'], position: [0.1, 0.2], velocity: [1, 2], effort: [] });
	assert.deepEqual(f, { 'j1/position': 0.1, 'j2/position': 0.2, 'j1/velocity': 1, 'j2/velocity': 2 });
});

test('flatten: arrays by index, named elements by name, key/value pairs by key', () => {
	assert.deepEqual(fields({ ranges: [1, 2, 3] }), { 'ranges[0]': 1, 'ranges[1]': 2, 'ranges[2]': 3 });
	assert.deepEqual(fields({ ranges: new Float32Array([1, 2]) }), { 'ranges[0]': 1, 'ranges[1]': 2 });
	const diag = { status: [{ name: 'motor', level: 0, values: [{ key: 'temp', value: '41.5' }, { key: 'mode', value: 'auto' }] }] };
	assert.deepEqual(fields(diag), { 'status[motor]/level': 0, 'status[motor]/values/temp': 41.5 });
	// duplicate names fall back to indices
	assert.deepEqual(fields({ s: [{ name: 'a', v: 1 }, { name: 'a', v: 2 }] }), { 's[0]/v': 1, 's[1]/v': 2 });
});

test('flatten: arrays over the limit are skipped and reported', () => {
	const { values, skipped } = flattenMessage({ data: new Array(1000).fill(1), n: 1 }, { maxArray: 500 });
	assert.deepEqual(values, [['n', 1]]);
	assert.equal(skipped[0][0], 'data');
	assert.match(skipped[0][1], /1000/);
});

// ---- series ----

test('series: push, binary search, trim, growth and out-of-order samples', () => {
	const s = new Series(4);
	for (let i = 0; i < 10; i++)
		s.push(i, i * 10);
	assert.equal(s.length, 10);
	assert.equal(s.lowerBound(3.5), 4);
	assert.equal(s.indexAtOrBefore(3.5), 3);
	assert.equal(s.indexAtOrBefore(3), 3);
	assert.equal(s.indexAtOrBefore(-1), -1);
	s.trimBefore(6);
	assert.equal(s.length, 4);
	assert.equal(s.firstTime, 6);
	for (let i = 10; i < 40; i++)
		s.push(i, i);  // compacts / grows under the hood
	assert.equal(s.length, 34);
	assert.equal(s.lastTime, 39);
	s.push(20.5, -1);  // out of order
	assert.equal(s.timeAt(s.lowerBound(20.5)), 20.5);
	assert.equal(s.valueAt(s.lowerBound(20.5)), -1);
	for (let i = 1; i < s.length; i++)
		assert.ok(s.timeAt(i) >= s.timeAt(i - 1));
	s.push(NaN, 1);
	assert.equal(s.length, 35);
});

// ---- transforms ----

test('transforms: derivative, scale, moving average, abs, and bad saved values', () => {
	const s = new Series();
	[[0, 0], [1, 2], [2, 6], [3, 6]].forEach(([t, v]) => s.push(t, v));
	assert.deepEqual([...applyTransform(s, 0, 4, { kind: 'derivative' })].map((v) => (Number.isNaN(v) ? 'nan' : v)), ['nan', 2, 4, 0]);
	assert.deepEqual([...applyTransform(s, 1, 3, { kind: 'scale', gain: 2, offset: 1 })], [5, 13]);
	assert.deepEqual([...applyTransform(s, 2, 4, { kind: 'moving_average', samples: 2 })], [4, 6]); // reaches back before i0
	assert.deepEqual([...applyTransform(s, 0, 2, { kind: 'abs' })], [0, 2]);
	assert.deepEqual(normalizeTransform({ kind: 'bogus' }), { kind: 'none' });
	assert.deepEqual(normalizeTransform({ kind: 'moving_average', samples: 'x' }), { kind: 'moving_average', samples: 10 });
	assert.equal(transformTag({ kind: 'scale', gain: 2, offset: -1 }), '×2 -1');
	assert.equal(transformTag({ kind: 'none' }), '');
});

// ---- chart math ----

test('ticks: round steps, labels without float noise', () => {
	assert.deepEqual(niceTicks(0, 10, 5).ticks, [0, 2, 4, 6, 8, 10]);
	const { ticks, step } = niceTicks(0.1, 0.35, 5);
	assert.equal(step, 0.05);
	assert.deepEqual(ticks.map((t) => formatTick(t, step)), ['0.10', '0.15', '0.20', '0.25', '0.30', '0.35']);
	assert.deepEqual(niceTicks(1, 1).ticks, []);
	assert.equal(formatValue(0.30000000000000004), '0.3');
	assert.equal(formatValue(NaN), '–');
	assert.deepEqual(paddedRange(5, 5), [4.5, 5.5]);
	assert.deepEqual(paddedRange(0, 0), [-1, 1]);
	assert.equal(paddedRange(NaN, 1), null);
});

test('decimate: keeps every point when few, and the spikes when many', () => {
	const few = decimate(new Float64Array([0, 1, 2]), new Float64Array([5, 6, 7]), 0, 2, 100);
	assert.equal(few.count, 3);
	const n = 100000;
	const times = new Float64Array(n);
	const values = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		times[i] = i;
		values[i] = Math.sin(i / 1000);
	}
	values[54321] = 50;   // a one-sample spike
	values[777] = NaN;    // a gap
	const out = decimate(times, values, 0, n, 200);
	assert.ok(out.count <= 200 * 4, `${out.count} points`);
	let max = -Infinity, nan = false;
	for (let i = 0; i < out.count; i++) {
		if (Number.isNaN(out.ys[i])) nan = true;
		else max = Math.max(max, out.ys[i]);
		if (i) assert.ok(out.xs[i] >= out.xs[i - 1], 'in time order');
	}
	assert.equal(max, 50);
	assert.ok(nan, 'the gap is kept');
});

// ---- layout ----

test('layout: a broken or empty save becomes a valid state', () => {
	const s = L.normalizeState(null);
	assert.equal(s.tabs.length, 1);
	assert.equal(s.active, s.tabs[0].id);
	const bad = L.normalizeState({ tabs: [{ name: '', root: { kind: 'split', children: [{ kind: 'plot', curves: [{ topic: 'nope', field: 'x' }, { topic: '/a', field: 'x', color: 'red' }] }] } }], window: -5, buffer: 'x', timeSource: 'bogus', pinned: [{ topic: '/p' }, { topic: '/p' }, { topic: 3 }] });
	assert.equal(bad.tabs[0].name, 'Tab 1');
	assert.equal(bad.tabs[0].root.kind, 'plot'); // a split with one child collapses
	assert.equal(bad.tabs[0].root.curves.length, 1);
	assert.match(bad.tabs[0].root.curves[0].color, /^#[0-9a-f]{6}$/i);
	assert.equal(bad.window, 0.5);
	assert.equal(bad.buffer, 60);
	assert.equal(bad.timeSource, 'receive');
	assert.deepEqual(bad.pinned, [{ topic: '/p', type: '' }]);
});

test('layout: split, resize, remove and the curves of a tab', () => {
	let root = L.newPlot();
	const first = root.id;
	let r = L.splitPlot(root, first, 'row');
	root = r.root;
	const second = r.plot.id;
	assert.equal(root.kind, 'split');
	r = L.splitPlot(root, second, 'row'); // same direction: a third child, not a nested split
	root = r.root;
	assert.equal(root.children.length, 3);
	assert.deepEqual(root.sizes, [0.5, 0.25, 0.25]);
	r = L.splitPlot(root, second, 'column');
	root = r.root;
	assert.equal(L.findNode(root, second) !== null, true);
	assert.equal(root.children[1].kind, 'split');
	root = L.setSizes(root, root.id, [2, 1, 1]);
	assert.deepEqual(root.sizes, [0.5, 0.25, 0.25]);
	root = L.addCurve(root, first, { topic: '/odom', type: 'nav_msgs/msg/Odometry', field: 'twist/twist/linear/x' });
	root = L.addCurve(root, first, { topic: '/odom', type: 'nav_msgs/msg/Odometry', field: 'twist/twist/linear/x' }); // once
	root = L.addCurve(root, first, { topic: '/imu', type: '', field: 'linear_acceleration/z' });
	assert.equal(L.findNode(root, first).curves.length, 2);
	assert.notEqual(L.findNode(root, first).curves[0].color, L.findNode(root, first).curves[1].color);
	root = L.updateCurve(root, first, 1, { transform: { kind: 'scale', gain: 'x' } });
	assert.deepEqual(L.findNode(root, first).curves[1].transform, { kind: 'scale', gain: 1, offset: 0 });
	root = L.removeCurve(root, first, 0);
	assert.equal(L.findNode(root, first).curves.length, 1);
	for (const plot of L.plotsIn(root).slice()) {
		if (plot.id !== first)
			root = L.removeNode(root, plot.id);
	}
	assert.equal(root.kind, 'plot');
	assert.equal(root.id, first);
	assert.notEqual(L.removeNode(root, first).id, first); // the last plot is replaced by an empty one
});

test('layout: XY curves, modes, tabs, and the topics a state needs', () => {
	let state = L.defaultState();
	const tab = state.tabs[0];
	let root = L.setMode(tab.root, tab.root.id, 'xy');
	root = L.addXYCurve(root, root.id, { topic: '/odom', field: 'pose/pose/position/x' }, { topic: '/odom', field: 'pose/pose/position/y' });
	state = L.setTabRoot(state, tab.id, root);
	state = { ...state, pinned: [{ topic: '/battery', type: 'sensor_msgs/msg/BatteryState' }] };
	assert.deepEqual([...L.topicsIn(state)], [['/odom', ''], ['/battery', 'sensor_msgs/msg/BatteryState']]);
	state = L.addTab(state);
	assert.equal(state.tabs.length, 2);
	assert.equal(state.active, state.tabs[1].id);
	state = L.renameTab(state, state.tabs[1].id, '  Motors ');
	assert.equal(state.tabs[1].name, 'Motors');
	state = L.moveTab(state, state.tabs[1].id, 0);
	assert.equal(state.tabs[0].name, 'Motors');
	state = L.removeTab(state, state.tabs[0].id);
	assert.equal(state.tabs.length, 1);
	assert.equal(state.active, state.tabs[0].id);
	const again = L.normalizeState(JSON.parse(JSON.stringify(state)));
	assert.deepEqual(again, state); // a saved state reads back unchanged
});

// ---- csv ----

test('csv: rows merged by time, empty cells where a series has no sample', () => {
	const csv = toCsv([
		{ name: '/a/x', times: [1, 2, 3], values: [10, 20, 30] },
		{ name: 'b,"quoted"', times: [2, 4], values: [0.5, NaN] },
	], { t0: 1 });
	assert.equal(csv, 'time,/a/x,"b,""quoted"""\n0.000000,10,\n1.000000,20,0.5\n2.000000,30,\n3.000000,,\n');
});

// ---- store ----

function fakeRos() {
	const subs = [];
	const timers = [];
	let now = 100;
	return {
		subs,
		timers,
		tick: (dt) => { now += dt; },
		options: {
			subscribe: (topic, type, throttle, callback, qos, options) => {
				const sub = { topic, type, callback, options, active: true };
				subs.push(sub);
				return () => { sub.active = false; };
			},
			now: () => now,
			resolveType: async (topic) => (topic === '/known' ? 'std_msgs/msg/Float64' : null),
			setTimer: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
			clearTimer: (t) => { if (t) t.cleared = true; },
			setRepeat: () => 0,
			clearRepeat: () => {},
		},
		send(topic, msg) {
			for (const sub of subs.filter((s) => s.active && s.topic === topic))
				sub.callback(msg);
		},
	};
}

test('store: one subscription per topic for several owners, every field recorded', async () => {
	const ros = fakeRos();
	const store = new PlotStore(ros.options);
	store.want('panel1', { '/odom': 'nav_msgs/msg/Odometry' });
	store.want('panel2', new Map([['/odom', ''], ['/imu', 'sensor_msgs/msg/Imu']]));
	assert.equal(ros.subs.filter((s) => s.active).length, 2);
	assert.equal(ros.subs[0].options.queueLength, 100); // every sample, not only the latest
	ros.send('/odom', { twist: { twist: { linear: { x: 1 } } }, child_frame_id: 'base' });
	ros.tick(0.1);
	ros.send('/odom', { twist: { twist: { linear: { x: 2 } } } });
	const series = store.series('/odom', 'twist/twist/linear/x');
	assert.equal(series.length, 2);
	assert.equal(series.lastValue, 2);
	assert.equal(store.t0, 100);
	assert.deepEqual(store.fieldsOf('/odom'), ['twist/twist/linear/x']);
	store.release('panel1');
	assert.equal(ros.subs.filter((s) => s.active && s.topic === '/odom').length, 1, 'panel2 still needs it');
	store.release('panel2');
	assert.equal(ros.subs.filter((s) => s.active).length, 0);
	assert.equal(store.series('/odom', 'twist/twist/linear/x').length, 2, 'samples stay until they age out');
});

test('store: header time source, buffer trimming, settings and clear', () => {
	const ros = fakeRos();
	const store = new PlotStore(ros.options);
	const events = [];
	store.on((e) => events.push(e.kind));
	store.want('p', { '/s': 'x/msg/Y' });
	store.setSettings({ timeSource: 'header', buffer: 5 });
	for (let i = 0; i < 10; i++)
		ros.send('/s', { header: { stamp: { sec: 1000 + i, nanosec: 0 } }, v: i });
	const series = store.series('/s', 'v');
	assert.equal(series.firstTime, 1000);
	store.trim();
	assert.equal(series.firstTime, 1004);
	assert.equal(store.t0, 1004);
	assert.ok(events.includes('settings'));
	store.clear();
	assert.equal(series.length, 0);
	assert.ok(Number.isNaN(store.t0));
	assert.deepEqual(store.fieldsOf('/s'), ['header/stamp', 'v']);
});

test('store: a topic with no type yet is looked up, and an idle subscription is renewed', async () => {
	const ros = fakeRos();
	const store = new PlotStore(ros.options);
	store.want('p', { '/known': '' });
	assert.equal(ros.subs.length, 0);
	await new Promise((r) => setTimeout(r, 0));
	assert.equal(ros.subs.length, 1);
	assert.equal(ros.subs[0].type, 'std_msgs/msg/Float64');
	// no data: the retry timer subscribes again
	ros.timers.filter((t) => !t.cleared).at(-1).fn();
	assert.equal(ros.subs.filter((s) => s.active).length, 1);
	assert.equal(ros.subs.length, 2);
	store.want('p', { '/nobody': '' });
	await new Promise((r) => setTimeout(r, 0));
	assert.match(store.info('/nobody').status, /waiting/i);
	assert.equal(ros.subs.filter((s) => s.active).length, 0);
});

test('store: new samples raise one "data" event per task (it wakes the idle draw loops)', async () => {
	const ros = fakeRos();
	const store = new PlotStore(ros.options);
	const events = [];
	store.on((e) => events.push(e.kind));
	store.want('p', { '/s': 'x/msg/Y' });
	await Promise.resolve();
	events.length = 0;
	for (let i = 0; i < 5; i++)
		ros.send('/s', { v: i });
	await Promise.resolve();
	assert.equal(events.filter((k) => k === 'data').length, 1);
	ros.send('/s', { v: 9 });
	await Promise.resolve();
	assert.equal(events.filter((k) => k === 'data').length, 2);
});

test('layout: legend place cycles and survives a save', () => {
	let root = L.newPlot();
	assert.equal(root.legend, 'right');
	root = L.cycleLegend(root, root.id);
	assert.equal(root.legend, 'left');
	root = L.cycleLegend(L.cycleLegend(root, root.id), root.id);
	assert.equal(root.legend, 'right');
	const state = L.normalizeState({ tabs: [{ root: { kind: 'plot', legend: 'hidden' } }, { root: { kind: 'plot', legend: 'nonsense' } }] });
	assert.deepEqual(state.tabs.map((t) => t.root.legend), ['hidden', 'right']);
});

// ---- PlotJuggler layouts ----

const PJ_LAYOUT = `<?xml version='1.0' encoding='UTF-8'?>
<root>
 <tabbed_widget name="Main Window" parent="main_window">
  <Tab containers="1" tab_name="Arm &amp; base">
   <Container>
    <DockSplitter orientation="-" count="2" sizes="0.6;0.4">
     <DockArea name="...">
      <plot mode="TimeSeries" style="Lines" flip_x="false" flip_y="false">
       <range left="0" right="10" top="1" bottom="-1"/>
       <limitY min="-2" max="2"/>
       <curve name="/robot/joint_states/shoulder/position" color="#1F77B4"/>
       <curve name="/odom/twist/twist/linear/x" color="#d62728"/>
      </plot>
     </DockArea>
     <DockSplitter orientation="|" count="2" sizes="0.5;0.5">
      <DockArea name="..."><plot mode="XYPlot" style="Lines"><range/><limitY/>
       <curve name="xy" curve_x="/odom/pose/pose/position/x" curve_y="/odom/pose/pose/position/y" color="#2ca02c"/>
      </plot></DockArea>
      <DockArea name="..."><plot mode="TimeSeries" style="Lines"><range/><limitY/></plot></DockArea>
     </DockSplitter>
    </DockSplitter>
   </Container>
  </Tab>
  <Tab containers="1" tab_name="tab2"><Container><DockSplitter orientation="-" count="1" sizes="1">
   <DockArea name="..."><plot mode="TimeSeries"><curve name="/imu/linear_acceleration/z" color="#9467bd"/></plot></DockArea>
  </DockSplitter></Container></Tab>
  <currentTabIndex index="0"/>
 </tabbed_widget>
 <use_relative_time_offset enabled="1"/>
 <customMathEquations/>
</root>`;

test('PlotJuggler layout: tabs, splits, time and XY plots, colours, fixed ranges', () => {
	const topics = [['/robot/joint_states', 'sensor_msgs/msg/JointState'], ['/odom', 'nav_msgs/msg/Odometry']];
	const { tabs, curves } = importPlotJuggler(PJ_LAYOUT, topics);
	assert.equal(curves, 4);
	assert.deepEqual(tabs.map((t) => t.name), ['Arm & base', 'tab2']);
	const root = tabs[0].root;
	assert.equal(root.kind, 'split');
	assert.equal(root.direction, 'column'); // "-": stacked
	assert.deepEqual(root.sizes, [0.6, 0.4]);
	const top = root.children[0];
	assert.deepEqual(top.curves.map((c) => [c.topic, c.field, c.type, c.color]), [
		['/robot/joint_states', 'shoulder/position', 'sensor_msgs/msg/JointState', '#1f77b4'], // a two-level topic, found on the graph
		['/odom', 'twist/twist/linear/x', 'nav_msgs/msg/Odometry', '#d62728'],
	]);
	assert.deepEqual(top.y, [-2, 2]);
	const bottom = root.children[1];
	assert.equal(bottom.direction, 'row');
	assert.equal(bottom.children[0].mode, 'xy');
	assert.deepEqual([bottom.children[0].curves[0].x.field, bottom.children[0].curves[0].y.field], ['pose/pose/position/x', 'pose/pose/position/y']);
	assert.equal(bottom.children[1].curves.length, 0);
	// a topic not on the graph: split after its first segment
	assert.deepEqual(tabs[1].root.curves[0].topic, '/imu');
	// and it is a valid plot state
	const state = L.normalizeState({ tabs });
	assert.equal(state.tabs.length, 2);
	assert.equal(L.topicsIn(state).get('/odom'), 'nav_msgs/msg/Odometry');
});

test('PlotJuggler layout: names, and files that are not layouts', () => {
	assert.deepEqual(splitSeriesName('/a/b/c', ['/a', '/a/b']), { topic: '/a/b', field: 'c' });
	assert.deepEqual(splitSeriesName('/a/b/c', []), { topic: '/a', field: 'b/c' });
	assert.equal(splitSeriesName('/lonely', []), null);
	assert.throws(() => importPlotJuggler('<rviz/>'), /not a PlotJuggler layout/);
	assert.throws(() => importPlotJuggler('<root><tabbed_widget/></root>'), /no tabs/);
});

test('series browser: fields as a tree', () => {
	const tree = fieldTree(['pose/position/x', 'pose/position/y', 'pose/orientation', 'pose/orientation/yaw', 'stamp']);
	assert.deepEqual([...tree.children.keys()], ['pose', 'stamp']);
	const pose = tree.children.get('pose');
	assert.equal(pose.field, null);
	assert.deepEqual([...pose.children.get('position').children.keys()], ['x', 'y']);
	const orientation = pose.children.get('orientation');
	assert.equal(orientation.field, 'pose/orientation'); // a field that is also a group
	assert.equal(orientation.children.get('yaw').field, 'pose/orientation/yaw');
	assert.equal(tree.children.get('stamp').field, 'stamp');
});
