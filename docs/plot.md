# Plots

The **Plot** panel plots any numeric field of any topic over time, or one field against another,
the way PlotJuggler does. It is built into `vizanti_server`: Main menu → **Add panel…** → Plot
(touch UI: the + button). In the RViz UI it opens as a tab next to **3D View**, so it gets the
whole view area; click the tabs to switch between them, or drag the Plot tab to the side to see
both at once. Add more than one if you like; they share their data.

## Using it

**Pick what to record.** The list on the left has every topic on the ROS graph (⟳ refreshes it).
Tick a topic, or click its name to open it, and Vizanti records **every numeric field** of it
from then on. Its fields appear as a tree with their latest values, and the rate shows next to
the topic. The filter box narrows topics and fields by name (all words must match).

**Plot fields.** Drag a field onto a plot. To plot several at once, select them first (click,
Ctrl-click to add one, Shift-click for a range) and drag any of them. Or select fields and press
a plot's **+**, the way to do it on a touch screen, where taps add to the selection. A
double-click on a field adds it to the active plot (the one last clicked). Because everything in
a recorded topic is buffered, a field you add later shows its history at once.

**How fields are named** (as in PlotJuggler):

| In the message | Field |
|---|---|
| nested fields | `pose/pose/position/x` |
| `header.stamp`, any time or duration | `header/stamp`, in seconds |
| a quaternion | `orientation/x` … `w`, plus `orientation/roll`, `pitch`, `yaw` (radians) |
| `JointState` (a `name` list and arrays that go with it) | `shoulder/position`, `shoulder/velocity`, … |
| arrays | `ranges[3]` |
| arrays of elements with distinct `name`s | `status[motor_left]/level` |
| key / value pairs (`diagnostic_msgs/KeyValue`) | `status[motor_left]/values/temperature`, when the value is a number |
| booleans | 0 / 1 |

Strings are not plotted. Arrays longer than **Max array** (500 by default; images, point cloud
data) are left out, and the list says so under their topic.

**Plots and tabs.**
- Each plot has a header with:
  - **XY / t**: switch between a time series and an XY plot;
  - **+**: add the selected fields;
  - **☷**: the legend on the right, on the left, or hidden;
  - **◫** / **⊟**: split, putting a new plot to the right or below;
  - **⌫**: remove all curves;
  - **✕**: close the plot.
- Drag the bar between plots to resize them.
- Tabs sit above the plots. **+** adds one; double-click a tab to rename it; drag tabs to
  reorder them; × closes one. A tab with curves needs a second click on "Close?", so a slip does
  not lose it.

**Time series.** Every time plot in a panel shares one time axis, and one cursor: hovering over
any plot shows the values at that time in every plot's legend.
- **Following** (the default) shows the last **Window** seconds, moving with the newest data.
- **⏸ Pause** stops scrolling; recording goes on. **▶ Follow** jumps back to the newest data.
- Drag a box to zoom. This pauses, and sets the time range of all plots and the value range of
  that plot; a flat box zooms time only.
- Ctrl-drag, middle-drag or right-drag pans. On a touch screen, one finger pans.
- The wheel zooms time around the pointer. While following, it changes the window length
  instead. Shift + wheel zooms the value axis.
- A double-click fits the values again (and, when paused, the time range to all the data).
- Times are in seconds since the first recorded sample.

**XY plots.** Drop two fields: the first is X, the second Y. You can drop them both at once, or
one after the other (the plot says it is waiting for Y). The curve shows the time range the time
plots show, with a dot at the newest point. Box, wheel, pan and double-click work on both axes.

**Curves.** Click a curve's name in the legend to hide or show it. **⋯** (or right-click) has:
- its colour;
- a **transform**: derivative (d/dt), scale and offset, moving average (N samples), or absolute
  value;
- remove.

The legend shows the transform, e.g. `[d/dt]`.

**Toolbar.**
- **☰** shows or hides the topic list (drag its edge to resize it).
- **Buffer**: how many seconds of samples are kept for every recorded field (60 by default;
  older samples are dropped).
- **Time**: Receive time, or each message's header stamp (messages without one use the receive
  time). Use the header stamp for smooth derivatives and for data that arrives late.
  Changing it starts the recording over.
- **Max array**: see above.
- **Clear** forgets the recorded samples; the plots and fields stay.
- **CSV** downloads the curves of the shown tab: every sample in the buffer, transforms applied,
  one row per distinct time.
- **Import** adds the tabs of a **PlotJuggler layout** (`.xml`, from PlotJuggler's "Save
  layout"). It carries over:
  - tab names, splits and their sizes;
  - time series and XY plots, curve colours, fixed value ranges.

  Custom (Lua) series and plugin settings are not imported. PlotJuggler does not mark where a
  curve's topic name ends, so Vizanti matches it against the topics on the graph when you import.

The whole arrangement, curves, colours, transforms, window and buffer are saved with the layout,
like any panel (export, configs on the robot). The recorded samples are not.

## How it is built

```
public/js/plot/
  flatten.js        message -> numeric fields (the naming above)                     pure
  series.js         one field's samples: two Float64Arrays, binary search, trim      pure
  transforms.js     derivative, scale, moving average, abs on the samples in view    pure
  chart_math.js     ticks, labels, decimation, ranges                                pure
  layout.js         tabs, the split tree, curves; normalizeState() repairs any save  pure
  csv.js            series with their own timestamps -> one CSV                      pure
  plotjuggler_import.js  PlotJuggler layout XML -> tabs                              pure
  store.js          PlotStore: subscriptions and recording, shared by all panels
  plot_view.js      one plot: canvas, axes, legend, zoom / pan / hover
  series_browser.js the topic and field list
public/js/displays/plot_panel.js   the panel: toolbar, tabs, split DOM, draw loop, saving
```

- **One store per page** (`plotStoreFor(ctx)`). Each panel says which topics it needs
  (`want(owner, topics)`): the topics its curves read, and the ones ticked in the list. The store
  keeps one subscription per topic for the union of them, and drops a subscription when no panel
  needs it any more (its samples stay until they age out). Two panels never subscribe twice.
- **Every sample.** Displays subscribe with rosbridge `queue_length: 1`, since only the latest
  message matters to them. The store asks for 100 (`subscribe(…, { queueLength })`), so a busy
  connection queues samples instead of dropping them.
- **No data, no type.**
  - A topic whose type is not known yet is looked up with rosapi, again every 3 s until
    something publishes it.
  - A subscription that receives nothing is renewed after 5, 10, 20, 40 s and then every minute,
    as displays do. rosbridge matches QoS only to the publishers it sees when it subscribes, so
    this catches a publisher that starts later.
- **Storage.** A field is a `Series`: times and values in one contiguous run inside two
  `Float64Array`s. A time range is found by binary search, and drawing reads a subarray without
  copying. Samples that are too old are dropped by moving the start index, and the arrays are
  compacted or doubled only when the run reaches their end. Out-of-order samples (header stamps
  from several publishers) are inserted in place.
- **Drawing.**
  - Each plot is a 2D canvas.
  - Samples in view are reduced to the first, lowest, highest and last of each pixel column, so
    a one-sample spike survives and the line stays continuous; NaN breaks the line.
  - A panel redraws at most ~30 times a second, only when new samples arrived or the view
    changed, and only while it is shown. The store's `data` event wakes an idle panel.
- **Saving.** Every edit is a pure function on the layout state (`layout.js`). The panel keeps
  the state, and saves it to its `plot` property 0.4 s after the last edit, so a drag or a
  wheel zoom is one save. A changed `plot` property (an imported layout) is read back through
  `normalizeState`, which turns anything broken into a valid layout.

Measured on 2026-11-03 in Chromium (desktop), Lyrical, with the streams below for 65 s:
- streams: 1 kHz `Float64`, 200 Hz `Imu`, 100 Hz `JointState`, 50 Hz `Odometry`, 10 Hz stamped
  points;
- a 60 s window and buffer, 5 curves in 2 plots:

| Measure | Result |
|---|---|
| 1 kHz topic | all 60,926 samples kept (999 Hz received) |
| Drawing both plots | 0.7 ms median, 0.9 ms at the 90th percentile |
| Recording 84,000 messages | 6.4 ms of main thread per second |
| Page | 60 fps, 35 MB JS heap |

## Tests

- `vizanti_server/test/js/plot.test.mjs` (`node --test`) covers the pure modules and the store,
  with a fake rosbridge.
- `vizanti_server/test/e2e/plot.spec.mjs` (Playwright, run in CI against a live server; the page
  publishes its own test signal) covers:
  - recording and dragging fields, an XY plot, splits and tabs;
  - box zoom and Follow;
  - a reload that restores everything and fills it with data again;
  - a PlotJuggler layout import.
- Checked by hand on 2026-11-03 against real topics at the rates above:
  - zoom, pan and wheel, double-click fit, the shared hover cursor;
  - the derivative transform against the published velocity, and legend placement;
  - closing tabs, CSV export, the header time source (a topic stamped 0.5 s late plotted 0.5 s
    earlier);
  - two panels sharing the store, closing a panel;
  - the touch UI on a phone-sized screen (tap to select, +, one-finger pan).
- Not checked: Humble and Jazzy (only Lyrical), `rmw_zenoh`, Firefox and Safari, a real phone.
