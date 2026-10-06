# The Vizanti UI

Vizanti is an RViz-style viewer in the browser: a real 3D scene, a Displays tree with property
editing and status, tools, and the node/bag/parameter utilities it always had. It has two
interfaces over one scene, and needs no build step.

## Run it

```bash
sudo apt-get install -y ros-lyrical-rosbridge-suite python3-waitress ros-lyrical-nav2-msgs   # once
cd ~/ros2_ws
colcon build --symlink-install --base-paths src/signalbotics/vizanti
source install/setup.zsh
ros2 launch vizanti_server vizanti_server.launch.py
```

Open `http://<robot>:5000/`. Stop the server with Ctrl+C in that terminal.

With `--symlink-install` the server serves `vizanti_server/public/` from the source tree, so
frontend changes only need a page reload. If `rosbridge_websocket` dies at launch with a
"symbol lookup error", the system ROS packages are older than rosbridge: run `sudo apt upgrade`.

## Two interfaces, one scene

- **RViz UI** (desktop): toolbar, 3D view, dockable Displays and Views panels. Widget icons sit
  in the toolbar; their settings open as docked panels. Drag a panel's tab to move it (drop on
  an edge of another panel to split, or on its tab bar to stack); drag the borders between
  panels to resize them. The arrangement is saved with the layout.
- **Toolbar** (RViz UI): icons, with the name and shortcut in each tooltip. From the left:
  - The menu (☰): import a layout or `.rviz` file, export the layout, load, save or delete
    configs on the robot, save a screenshot, switch to the touch UI, reset the layout.
  - Add display, then the tools: Move Camera, Select, Measure, Publish Point, Focus Camera,
    2D Goal Pose (purple) and 2D Pose Estimate (green). The active tool is highlighted.
  - Then the widget icons.
  - At the right, one toggle per panel: 3D View (cube), Displays (layers), Views (camera) and
    Time (clock). A lit toggle means the panel is open.
  - Last, the switch to the touch UI (phone).

  The icons are SVGs in `public/assets/toolbar/`, drawn in the button's text colour.
- **Status bar** (bottom):
  - rosbridge connection;
  - whether the fixed frame exists in TF;
  - how many enabled displays have errors or warnings (click to jump to the first);
  - the active tool;
  - redraws per second and the last redraw's time ("Idle" when nothing changes, since the view
    only redraws on change).

  Green, yellow and red dots mean OK, warning and error.
- **Displays panel:** click a display's row to select it.
  - The icon row at the bottom acts on the selected display: add, duplicate, rename, move up,
    move down and remove.
  - Right-clicking a row gives the same actions, plus enable/disable.
  - Keys: F2 renames (Enter keeps the new name, Escape cancels) and Delete removes.
  - Drag a row up or down to reorder; a line shows where it will land.
  - Widgets that still run from their original template (rosbridge, teleop, …) can't be
    duplicated.
- **Property editor:**
  - Colour fields show their hex value next to the swatch.
  - Help text sits behind a "?" next to the property, and also appears as the label's tooltip.
  - In a narrow panel, labels go above their inputs.
- **QoS:** every display with a topic has a QoS setting.
  - **Auto** (default) lets rosbridge match the publishers. rosbridge only does that when it
    subscribes, and with no publisher yet it falls back to volatile / best effort, which would
    miss a map that is published once later. So while a display has received nothing, it
    subscribes again every 5 s.
  - **Reliable**, **Best effort** and **Latched (transient local)** are sent to rosbridge as an
    explicit profile. Latched only connects to latched publishers.

  Checked on 2026-10-06 against Lyrical: a map published once, latched, after Vizanti had
  subscribed arrived about 4 s later; with Latched selected, the request carried
  transient_local and the map arrived. rosbridge 2.x supports explicit QoS on all three
  distros (checked: Lyrical, Jazzy 2.7.1, Humble 2.0.8).
- **Costmap updates:** the Map display also subscribes to `map_msgs/OccupancyGridUpdate` patches
  ("Apply updates", on by default). The topic is the map topic plus `_updates`, as Nav2
  publishes them, or the one set in "Update topic". Each patch is written into the last full
  map and redrawn; a patch that does not fit the map is ignored with a warning. Checked on
  2026-10-06 with a test publisher (full 50×50 map every 5 s, 5×5 patches every 0.5 s): the
  patches accumulated between full maps and were drawn.
- **Point cloud:**
  - **Colour by:** RGB (from the cloud, else the flat colour), Flat, Channel (any field,
    `intensity` by default), or X/Y/Z in the fixed frame (height colouring). Channel and axis
    colours use a blue (low) to red (high) rainbow over each cloud's range.
  - **Style:** squares or circles sized in metres, or fixed-size points in pixels.
  - **Decay time:** keeps each cloud where it was measured, so a moving sensor leaves a trail.
    Changing a colour setting redraws only the latest cloud.
  - **`.rviz` import** maps Color Transformer (RGB8, FlatColor, Intensity with Channel Name,
    AxisColor with Axis), Style, Size (Pixels) and Decay Time.

  Checked on 2026-10-06 with a 5 Hz test lidar moving at 0.5 m/s:
  - intensity 0–359 went from blue to red;
  - with 2 s decay, 11 clouds were kept, and the oldest was 1.0 m behind the newest;
  - in height mode, the highest point was red and the lowest blue.
- **Laser scan:** colour by Flat (default), Intensity, or Range (distance), using the same blue
  to red rainbow. Decay time keeps recent scans where they were measured. `.rviz` import maps
  the Intensity transformer and Decay Time. Point clouds and scans share this trail code
  (`core/trail.js`). Checked on 2026-10-06 with a 5 Hz scan moving at 0.5 m/s: 10 scans kept
  for 2 s decay; intensity and range coloured blue to red; disable and enable work.
- **Grid:** the plane (XY, XZ or YZ of its frame) and an offset in that frame. `.rviz` import
  maps Plane, Offset and Reference Frame. The grid stays infinite with autoscale, so RViz's
  Plane Cell Count has no equivalent.
- **TF frames outside the fixed frame's tree:** a frame whose chain to the fixed frame is broken
  (its publisher stopped, or has not started) has no pose. It isn't drawn, and displays in it
  report that the transform is missing. Before 2026-10-06 such frames were drawn at the fixed
  frame's origin. A map that arrives before its TF is still drawn at the origin, with a
  warning, until TF connects it.
- **IMU** (`sensor_msgs/Imu`, under Sensors):
  - axes at the IMU frame showing its orientation in the fixed frame, as an AHRS reports it;
    hidden when the message says it has none (orientation covariance[0] = −1);
  - an arrow for the linear acceleration in the sensor frame, length = acceleration × scale;
  - roll / pitch / yaw, |a| and |ω| in the panel.

  `.rviz` import maps `rviz_imu_plugin/Imu` and `rviz_default_plugins/Imu`. Checked on
  2026-10-06 with a test IMU mounted at 90° yaw: the axes matched the reported orientation in
  the world, and the acceleration arrow turned with the mount.
- **Images in their own panel:** an Image display's "Show in" can be "Its own panel (RViz UI)".
  - The image gets a dockable panel named after the display, which is retitled when the display
    is renamed. The image fills the panel, keeping its aspect ratio.
  - Closing the panel disables the display, and enabling it brings the panel back.
  - The touch UI has no panels, so it shows the image in a corner.
  - Other display types can use the same mechanism through `wantsPanel` / `attachPanel(host)` /
    `detachPanel()`.

  Checked on 2026-10-06 with a 5 Hz test camera: the panel opened and survived a reload; rename,
  close, enable, switching to the corner and removal behaved as described; the touch UI used
  the corner.
- **Waypoints** (native 3D, replaces the old 2D widget; saved missions carry over):
  - **Edit positions:** click the ground to add a waypoint. Near the path, it is inserted into
    that leg. Drag a waypoint to move it (Shift snaps to 0.5 m); tap one to delete it. Dragging
    empty ground still moves the camera.
  - **Edit heights:** drag a waypoint up or down.
  - **Buttons:** Send mission publishes it latched, as `nav_msgs/Path` or
    `geometry_msgs/PoseArray`, in the mission frame, with each pose facing the next waypoint.
    Stop publishes an empty mission. There are also Flip order, Set all heights, Import CSV
    (x,y[,z]) and Clear (click twice).
  - **Start from the closest waypoint** skips the waypoints before the one nearest the robot
    frame.
  - The safety margin is drawn on both sides of the path.

  Checked on 2026-10-06 in the app, reading the result back from ROS:
  - add, insert, move, delete and height edits;
  - the latched Path received after sending, with headings facing the next waypoint;
  - start-from-closest, Stop (empty Path), and migration of an old widget's saved mission.

- **Bounding Box** (native, replaces the old 2D area widget and keeps its topic): press "Draw
  box", then drag on the ground from one corner to the opposite one. On release, the box is
  published as `geometry_msgs/PolygonStamped` in the fixed frame, and stays drawn. Checked on
  2026-10-06: ROS received the dragged box with the expected corners.

- **Survey** (native, replaces the old 2D widget; saved surveys carry over):
  - **Edit area:** click to add polygon vertices (near an edge to insert), drag vertices or the
    ST / FIN markers, tap a vertex to delete it.
  - **Edit heights:** drag vertices up or down.
  - With three vertices, ST and FIN are placed beside the robot frame, and the line spacing is
    sized for about ten lines.
  - The lawnmower path (spacing, angle, turnaround, criss-cross, direct transits) comes from the
    old widget's planner, unchanged, in `js/workers/survey_worker.js`. It is redrawn after each
    edit and sent latched like a waypoint mission.

  Checked on 2026-10-06 in the app:
  - a 10 m square gave 10 lines and 22 waypoints;
  - dragging FIN re-planned the path;
  - ROS received the 23-pose Path;
  - an old saved survey migrated.

  The old waypoints, area and survey templates are deleted.
- **Performance** (measured 2026-10-06 on the development machine, desktop GPU):

  | Load | Cost |
  |---|---|
  | 200,000-point cloud, coloured by intensity | about 24 ms per message (7 ms decode, 2 ms colour, the rest upload) |
  | 2000 × 2000 map | 5 ms on the main thread (converted in a worker) |
  | Full redraw with all of the above and the 70-mesh Panda arm (136,000 triangles) | 0.3 ms median, 1.4 ms at the 90th percentile |

  Colouring used to take about 40 ms; it now uses a 1024-step lookup table. rosbridge, not
  the page, is the limit: two 200,000-point clouds at about 6 Hz with no throttle (about
  19 MB/s) stalled every topic on the connection. Keep the point cloud throttle (default
  1 s) for big clouds.
- **Large messages and QoS:** for a reliable publisher, rosbridge's automatic QoS is best
  effort. Best effort drops large messages (a 3.2 MB cloud never arrived), while small ones
  like TF work. Set QoS to Reliable on such displays; an Auto display that gets nothing says
  so in its status. The Auto re-subscribe backs off (5, 10, 20, 40 s, then once a minute).
- **Add dialog:** a search box (focused when the dialog opens) filters by name, description,
  message type or topic, and Enter adds the first match. Displays are grouped by category; a
  plugin display can set `static category`. The flat 2D robot picture is now called "Robot
  Sprite (2D)", so it isn't confused with "Robot Model (URDF)".
- **Touch UI** (phones and tablets): icon bar, one modal per widget, folders.

Both drive the same displays. Switch with the phone icon at the right of the toolbar or
Global Settings → "Switch to RViz UI". Force one with `?ui=rviz` or `?ui=touch`. The choice is
remembered per browser (storage key `vizanti_ui`).

The RViz UI opens in the 3D orbit camera (left-drag rotates, right-drag pans, wheel zooms); the
touch UI opens top-down. Change it under Views / Global Settings → Camera.

- **FPS (first person):** left-drag looks around (drag up to look up), right-drag slides the
  camera sideways and up, the wheel moves forward and back, arrow keys move and strafe while
  the pointer is over the view (Shift for four times the step), PageUp/PageDown move up and
  down. Orbit and FPS share one camera pose, so switching between them keeps the view.

- **Target frame:** the camera moves with that TF frame. Tick "Turn with target frame" and the
  orbit camera also swings round as the frame turns (a third-person view behind the robot).
- **Saved views:** type a name under "Saved views" and press "Save current view" (Enter works
  too; an empty name becomes "view N"). "Go" jumps back to it and ✕ deletes it. Saving a name
  that exists replaces it. Views are part of the layout (`ui.saved_views`), so they are exported
  and saved to the robot with it.

## Saved layouts, configs on the robot, screenshots, time

**Starting from a robot config:**
- `http://<robot>:5000/?config=<name>` loads a config saved on the robot. It is applied once
  and then removed from the address, so a reload keeps your changes.
- The `default_config:=<name>` launch argument (both launch files) is what a browser with no
  layout of its own starts from, before the `default_widget_config` file.
- A missing or unreadable config shows a notice and leaves the layout as it was.

Checked on 2026-10-06: `?config=` loaded a saved config and cleared itself; a missing name gave
the notice; a fresh browser on a server launched with `default_config` got that config.

The layout (widgets, their settings, global options, camera, panel arrangement) is saved in
browser storage under `vizanti_v2`. Export and import it from Global Options.

- **RViz configs:** Import also takes an RViz 1 or RViz 2 `.rviz` file. Its displays replace the
  current ones (groups are flattened; displays in a disabled group come in disabled), and its
  fixed frame, background colour and current view (Orbit, XYOrbit, ThirdPersonFollower, FPS,
  TopDownOrtho) are applied. Widgets such as the rosbridge connection, teleop and tools are
  kept. A notice lists the RViz displays Vizanti has no equivalent for (MoveIt, IMU,
  `sensor_msgs/PointCloud`, vendor plugins…); they are left out. Topics, colours, alpha, sizes
  and the common per-display options carry over; the rest takes Vizanti defaults. The
  converter is `public/js/core/rviz_import.js`; it was run over the 409 `.rviz` files on the
  development machine without a parse failure.

- A browser that still has a layout from the old 2D UI (storage key `settings`) has it converted
  on first load. The old data is left in place.
- The `default_widget_config` launch parameter accepts both the old format and the new one.
- An unreadable layout is kept under `vizanti_v2_backup` and the default is loaded.
- **Configs on the robot:** Global Options → "On the robot" saves, loads and deletes named
  layouts on the Vizanti server, so every browser can use them. They are JSON files in
  `~/.vizanti/configs` (launch argument `config_dir`). Names may only use letters, digits, `-`
  and `_`; files are limited to 2 MB.
- **Screenshots:** Global Options → "Save screenshot" downloads the 3D view with its text
  overlay as a PNG.
- **Time:** the RViz UI's Time panel shows ROS time, elapsed ROS time and wall time. ROS time
  follows `/clock` while it is being published (simulation), otherwise the system clock.

## What is drawn how

**Native 3D displays** (`js/displays/`): Grid, TF, Map, Laser Scan, Point Cloud, Marker Array,
Marker, Interactive Markers, Path, Pose, Pose Array, Pose Tracker, Point, Polygon,
Wrench / Twist / Accel, Axes,
Range, Grid Cells, Image (uncompressed), Camera, Depth Cloud, Sensor Value, Satellite Tiles,
Robot Model (sprite), Robot Model (URDF).

**Depth Cloud** turns a `16UC1` (millimetres) or `32FC1` (metres) depth image into points using
CameraInfo, taking every n-th pixel. **Sensor Value** writes the reading of a Temperature,
FluidPressure, Illuminance or RelativeHumidity message at the sensor's frame.

**Camera** places an image (raw or compressed) on the image plane of the camera's frustum in
3D, sized from `sensor_msgs/CameraInfo`, optionally with the frustum outline and a copy in a
corner of the view. Adding it from a topic fills in the neighbouring `camera_info` topic.

Laser scans, point clouds, images and maps are received as CBOR (binary) rather than JSON,
which is smaller and faster to decode; the template widgets keep the server's default.
Each declares its properties as data, and both interfaces generate their controls from that.
Marker and Marker Array draw every marker type as real 3D geometry; mesh markers need
`package://` paths to `.stl`, `.dae` or `.obj` files.

**Interactive Markers** connect to an `interactive_markers` server by its namespace (for
example `/basic_controls`): the markers are drawn in 3D, and in the Move Camera tool a press on
a control drags it along its axis or plane, turns it around its axis, clicks a button, or opens
its menu. Feedback goes to `<namespace>/feedback`. Controls without markers get the usual arrows
and rings. `ROTATE_3D` and view-facing controls are drawn but only moved in the view plane.

**Built-in tools** (toolbar in the RViz UI; Global Settings → Tools in the touch UI), with the
RViz keyboard shortcuts:

| Tool | Key | What it does |
|---|---|---|
| Move Camera | m | The default. Esc returns to it. |
| Select | s | Click an object: a box shows the display that drew it, its topic and frame, the URDF link or marker (namespace and id) or point-cloud point, and the clicked point in the fixed frame. Stays armed; a click on empty space clears it. Lines, grids and text labels cannot be selected. |
| Measure | n | Click two points; the distance is shown on the line. |
| Publish Point | c | Click a point; publishes `geometry_msgs/PointStamped` on `/clicked_point`. |
| Focus Camera | f | Click a point; the camera centres on it. |
| 2D Goal Pose | g | Press and drag for heading; publishes `geometry_msgs/PoseStamped` on `/goal_pose`. |
| 2D Pose Estimate | p | Same gesture; publishes `PoseWithCovarianceStamped` on `/initialpose`. |

Measure, Publish Point and Focus pick the nearest solid object or point-cloud point under the
pointer, falling back to the ground plane. The pose tools work on the ground plane (z = 0) of
the fixed frame. The three topics can be changed under Views → Tool topics.

**Robot Model (URDF)** reads the description from `/robot_description` (published by
`robot_state_publisher`) and draws every link's boxes, cylinders, spheres and meshes at the
link's TF frame, so the joints move with TF. Options: visual and collision geometry, alpha, a
TF prefix, and per-link visibility. Meshes referenced as `package://<pkg>/<path>` (`.stl`,
`.dae`, `.obj`) are served by the Vizanti server from that package's share directory at
`/package/<pkg>/<path>`; only mesh and texture file types are served, and paths cannot leave
the package. `file://` mesh paths are not supported.

**Widgets** (`js/core/widget.js`): Rosbridge, Battery, Temperature, Speedometer, Altimeter,
Attitude Indicator, Button, 2D Nav Goal and 2D Pose Estimate are native widgets: a live icon and
a panel. The 2D Nav Goal and 2D Pose Estimate widgets arm the view's pose tool with their own
topic for one pose, so several of them can drive several robots. The Button acts on a
click (publish Empty / Bool, call an Empty / Trigger / SetBool service); right-click it in the
RViz UI, or long-press it in the touch UI, for its panel and settings. In the RViz UI the icon sits in the toolbar's widget strip
and opens the panel as a dock tab; in the touch UI the icon is in the bar and the panel is at the
top of its settings modal. Their old saved settings (`{state: {...}}`) are converted on load.
The Altimeter (a height / depth tape along a side of the view) and the Attitude Indicator (a
navball) draw on the view's 2D overlay in both UIs. Drag the navball to move it; with a target
topic set, click the altimeter tape near its ticks to publish that target (std_msgs/Float32).

**Template widgets** (`templates/`): Teleop and the
panels (Node Manager, Bag Recorder, Parameter Reconfigure, Diagnostics, Topic Inspector,
Folder). Compressed Image is now a native display like Image (plus rotation, rate and
bandwidth). These still run their original
scripts. A compatibility layer (`js/legacy/`, `js/modules/view.js`, `js/modules/persistent.js`)
gives them the page functions and the settings object they expect, and projects their drawing
through the 3D camera onto the ground plane (z = 0), so the tools work in both the top-down and
the orbit view.

## Run the tests

```bash
cd vizanti_server && node --test "test/js/*.test.mjs"
```

These cover the browser-free code: property validation, storage, the registry, TF frame nodes,
the `Display` base class, old-layout conversion and every display's message-to-geometry
function. Rendering and the two interfaces are checked in a browser.

## Add a display

Create one file in `vizanti_server/public/js/displays/`. Every `.js` file there is loaded at
startup, and every exported class with a static `type` becomes an available display. A display
type with the same name as a template folder replaces that template.

```js
import { Display } from '../core/display.js';

export class MyDisplay extends Display {
	static type = "my";                                  // unique id, used in saved layouts
	static label = "My Display";
	static icon = "assets/marker.svg";
	static description = "Shown in the Add dialog.";
	static msgTypes = ["geometry_msgs/msg/PointStamped"];

	static properties = {
		topic: { type: "topic", label: "Topic" },          // the framework subscribes to this
		color: { type: "color", label: "Colour", default: "#ff0000" },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 100, min: 0, max: 10000 },
	};

	onCreate() { /* build three.js objects, this.add(object) */ }
	onMessage(msg) { /* this.setFrame(msg.header); update geometry */ }
	onPropertyChange(key, value) { /* restyle */ }
	onDestroy() { /* dispose geometry and materials */ }
}
```

- Property types: `topic`, `frame`, `bool`, `int`, `float`, `color`, `enum`, `string`, `object`
  (stored, no control) and `group` (layout only). `hidden: true` keeps a property out of the UI.
- A display that accepts several message types lists them in `msgTypes` and declares a hidden
  `topic_type` string property; the framework looks the type up and `this.topicType` holds it.
- `this.setFrame(header)` places the display at the transform it had when the message arrived;
  `this.setFrame(header, { follow: true })` makes it follow the frame live.
- `this.status.warn(text)` / `.error(text)` show in the UI. "No data received", "Empty topic"
  and missing transforms are reported for you.
- `this.setInfo({ Points: 120 })` shows read-only live values.
- Optional: `onTfChange()`, `onFixedFrameChange()`, `onCameraChange()`, `onContextRestored()`,
  `onOverlay(ctx2d, scene)` for text drawn over the view, `buildCustomEditor(container)` for UI
  the property types cannot express, `static fromLegacy(state)` to read old saved settings.
- Keep the message-to-geometry conversion in a pure function under `js/geometry/` so it can be
  unit tested without a browser.
- An exception in any hook is caught and shown as that display's error status.

## Add a widget

A widget extends `WidgetDisplay` (`js/core/widget.js`) and spreads `WIDGET_PROPERTIES` into its
properties. It shows `this.icon` (or, with `buildIcon(face)`, draws its own 50×50 icon: fill
`face` and return a function that repaints it) and calls `this.refreshIcon()` when the icon
changes. `buildPanel(container)` builds the panel once; `static migrateProps(props)` converts
the settings a template widget of the same type saved. See `displays/battery_widget.js` (an
icon per level) and `displays/speedometer_widget.js` (a drawn gauge).

A widget that draws on the view implements `onOverlay(ctx, scene)` (CSS pixels) and, to take
presses on what it drew, `onHudPointer(kind, {x, y, event})`: return true from "down" to claim
the press (with any tool active); "move" and "up" follow. A display that gets its data from
somewhere other than its `topic` can return false from `get subscribes()`. A widget with
`onIconClick()` acts on a click instead of opening its panel (the Button). A `topic` property may
set `optional: true` (adds "(none)"), its own `msgTypes`, and `serviceTypes` to offer services too.

## Display plugins from other packages

Any ROS package can add displays without touching Vizanti:

1. Put display modules in `vizanti/displays/*.js` in the package, written as in "Add a display"
   but importing the framework three directories up, e.g.
   `import { Display } from '../../../js/core/display.js';`
2. In its `CMakeLists.txt`, install that folder and register the resource:

   ```cmake
   install(DIRECTORY vizanti DESTINATION share/${PROJECT_NAME}/)
   ament_index_register_resource(vizanti_displays)
   ```

3. Build and source the workspace, then restart the Vizanti server.

The server lists every package with the `vizanti_displays` resource at `/plugins/paths` and
serves its `share/<package>/vizanti/` folder at `/plugins/<package>/` (only `.js`, `.css`,
`.svg`, `.png` and `.json` files). A plugin type with the same name as a built-in display is not
loaded. `vizanti_demos` ships a working example, "Frame Label (plugin example)", in
`vizanti_demos/vizanti/displays/frame_label.js`.

## Where things are

| Path (under `vizanti_server/public/js/`) | What |
|---|---|
| `core/app.js` | Startup and wiring |
| `core/registry.js` | The list of widgets, global options, save/load |
| `core/display.js` | `Display` base class |
| `core/scene.js` | Renderer, cameras, lights, render loop |
| `core/frames.js` | Scene nodes that follow TF |
| `core/properties.js` | Property validation |
| `core/legacy_layout.js` | Conversion of old saved layouts |
| `displays/` | One file per native display |
| `geometry/` | Pure message-to-geometry functions |
| `legacy/` | Hosting for template widgets |
| `modules/` | TF, rosbridge, and the compatibility shims for template widgets |
| `ui/` | Property editor, the two interfaces, dialogs |
| `lib/` | Vendored three.js 0.160.0 and dockview-core 8.3.1 |

## Verification status (2026-09-30)

Checked in a browser against a live rosbridge with a test publisher for every message type:
all 14 native displays (top-down and orbit), the 20 template widgets loading without errors in
both interfaces, a tool publishing at the clicked ground point with a real mouse, folders,
docked widget panels, conversion of an old saved layout, reconnecting, throttling, and saving
and restoring.

Not checked: a phone or tablet (touch gestures, frame rate); each template widget exercised in
depth against real data (they load and open, and one tool and one panel were driven end to
end); Satellite Tiles offline; waypoint and survey editing in the orbit view.

## Known limits and small issues

- The tools and other template widgets draw on a 2D overlay projected onto the ground plane.
  They are not yet native 3D tools (no picking of 3D objects, no editing above z = 0).
- The URDF robot model needs the package that holds the meshes to be installed on the machine
  running the Vizanti server. It was checked with the Panda arm (Collada visuals, STL
  collisions), at rest and, on 2026-10-06, with two joints sweeping at 20 Hz through
  robot_state_publisher: the drawn links followed TF exactly. `.obj` and textured meshes were
  not checked.
- A browser tab in the background slows its timers (Chrome throttles them to about once a
  minute after a few minutes hidden), so the status bar and the QoS retry run late there; they
  catch up when the tab is shown.
- Handing a very large map to the colour-conversion worker blocks the page briefly (about
  150 ms for 2000 x 2000 cells).
- The Point Cloud "RGB Colour Count" option is gone: per-point colours are drawn directly.
- `Contributing.md` still describes the old page structure (`main.js`, `setup.js`).
- In the orbit view, a tool ignores clicks above the horizon (there is no ground there) and says so.
- Maps and satellite tiles are ground layers: they always draw beneath the other displays,
  whatever the display order, so an opaque map never hides a scan or TF at the same height.
  Display order still decides which of two maps is on top.
