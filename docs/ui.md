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
  in the toolbar; their settings open as docked panels.
- **Touch UI** (phones and tablets): icon bar, one modal per widget, folders.

Both drive the same displays. Switch with the "Touch UI" toolbar button or
Global Settings → "Switch to RViz UI". Force one with `?ui=rviz` or `?ui=touch`. The choice is
remembered per browser (storage key `vizanti_ui`).

The RViz UI opens in the 3D orbit camera (left-drag rotates, right-drag pans, wheel zooms); the
touch UI opens top-down. Change it under Views / Global Settings → Camera.

## Saved layouts

The layout (widgets, their settings, global options, camera, panel arrangement) is saved in
browser storage under `vizanti_v2`. Export and import it from Global Options.

- A browser that still has a layout from the old 2D UI (storage key `settings`) has it converted
  on first load. The old data is left in place.
- The `default_widget_config` launch parameter accepts both the old format and the new one.
- An unreadable layout is kept under `vizanti_v2_backup` and the default is loaded.

## What is drawn how

**Native 3D displays** (`js/displays/`): Grid, TF, Map, Laser Scan, Point Cloud, Marker Array,
Path, Pose, Pose Array, Pose Tracker, Range, Grid Cells, Satellite Tiles, Robot Model (sprite).
Each declares its properties as data, and both interfaces generate their controls from that.
Marker Array draws every marker type as real 3D geometry except `MESH_RESOURCE`.

**Template widgets** (`templates/`): the tools (2D Pose Estimate, 2D Nav Goal, Waypoint Mission,
Survey Mission, Bounding Box), Teleop, Button, and the panels (Node Manager, Bag Recorder,
Parameter Reconfigure, Diagnostics, Topic Inspector, Battery, Temperature, Speedometer,
Altimeter, Attitude Indicator, Compressed Image, Rosbridge, Folder). These still run their
original scripts. A compatibility layer (`js/legacy/`, `js/modules/view.js`,
`js/modules/persistent.js`) gives them the page functions and the settings object they expect,
and projects their drawing through the 3D camera onto the ground plane (z = 0), so the tools
work in both the top-down and the orbit view.

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
- `MESH_RESOURCE` markers are not drawn. There is no URDF robot model yet, only the sprite.
- In the orbit view the grid reaches far enough to alias into dots near the horizon, and
  Satellite Tiles pick a coarser zoom than needed.
- A display that was disabled while the camera or TF moved is not redrawn until the next camera
  or TF change after it is enabled again.
- With a map of the wrong size arriving repeatedly, the status alternates between Ok and the error.
- A map conversion still running when the topic is changed can show the old topic's map once.
- Changing the throttle shows "No data received." until the next message.
- "Loading topics..." never ends when rosbridge is down.
- Handing a very large map to the colour-conversion worker blocks the page briefly (about
  150 ms for 2000 x 2000 cells).
- The top-down camera does not show anything more than 1000 m above the fixed frame origin.
- `js/modules/tf.js` reads `stamp.secs/nsecs`, which ROS 2 does not send, so "nearest the
  message stamp" lookups return the latest transform.
- The Point Cloud "RGB Colour Count" option is gone: per-point colours are drawn directly.
- The Camera selector in the Views panel does not follow a camera mode changed elsewhere.
- Removing a folder from the RViz UI's tree leaves the widgets that were inside it pointing at
  a folder that no longer exists; they reappear in the icon bar of the touch UI.
- Removing a tool while it is armed leaves camera movement switched off until the page reloads.
- The robot sprite has no error handling for a sprite image that fails to load.
- `Contributing.md` still describes the old page structure (`main.js`, `setup.js`).
- In the orbit view, a tool ignores clicks above the horizon (there is no ground there) and says so.
