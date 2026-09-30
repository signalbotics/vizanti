# The new Vizanti UI (`/next`)

Vizanti is being reworked into an RViz-style viewer with a real 3D scene. While that work is in
progress the new UI is served at `/next`; the existing UI at `/` is unchanged.

## Run it

```bash
sudo apt-get install -y ros-lyrical-rosbridge-suite python3-waitress ros-lyrical-nav2-msgs   # once
cd ~/ros2_ws
colcon build --symlink-install --base-paths src/signalbotics/vizanti
source install/setup.zsh
ros2 launch vizanti_server vizanti_server.launch.py
```

Open `http://<robot>:5000/next`. Stop the server with Ctrl+C in that terminal.

With `--symlink-install` the server serves `vizanti_server/public/` from the source tree, so
frontend changes only need a page reload.

## Two interfaces, one scene

- **RViz UI** (desktop): toolbar, 3D view, dockable Displays and Views panels.
- **Touch UI** (phones and tablets): icon bar, one modal per display.

Both drive the same displays. Switch with the "Touch UI" toolbar button or
Global Settings → "Switch to RViz UI". Force one with `?ui=rviz` or `?ui=touch`. The choice is
remembered per browser under the storage key `vizanti_ui`.

The layout (displays, their settings, global options, camera, panel arrangement) is saved in
browser storage under `vizanti_v2`. It is separate from the old UI's `settings` key. Export and
import it from Global Options.

## Run the tests

```bash
cd vizanti_server && node --test "test/js/*.test.mjs"
```

These cover the browser-free code: property validation, storage, the registry, TF frame nodes,
the `Display` base class and each display's message-to-geometry function. Rendering and the two
shells are checked by hand in a browser; the checklists are in the implementation plan.

## Add a display

Create one file in `vizanti_server/public/js/displays/`. Every `.js` file in that folder is loaded
at startup, and every exported class with a static `type` becomes an available display.

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
  (stored, no control) and `group` (layout only). Both UIs are generated from this declaration.
- `this.setFrame(header)` places the display at the transform nearest the message stamp;
  `this.setFrame(header, { follow: true })` makes it follow the frame live.
- `this.status.warn(text)` / `.error(text)` show in the UI. "No data received", "Empty topic"
  and missing transforms are reported for you.
- `this.setInfo({ Points: 120 })` shows read-only live values.
- Optional: `onTfChange()`, `onFixedFrameChange()`, `onCameraChange()`, `onContextRestored()`,
  `onOverlay(ctx2d, scene)` for text drawn over the view, `buildCustomEditor(container)` for UI
  the property types cannot express.
- Keep the message-to-geometry conversion in a pure function under `js/geometry/` so it can be
  unit tested without a browser.
- An exception in any hook is caught and shown as that display's error status.

## Where things are

| Path (under `vizanti_server/public/js/`) | What |
|---|---|
| `core/app.js` | Startup and wiring |
| `core/registry.js` | The list of displays, global options, save/load |
| `core/display.js` | `Display` base class |
| `core/scene.js` | Renderer, cameras, render loop |
| `core/frames.js` | Scene nodes that follow TF |
| `core/properties.js` | Property validation |
| `displays/` | One file per display |
| `geometry/` | Pure message-to-geometry functions |
| `ui/` | Property editor, the two shells, dialogs |
| `lib/` | Vendored three.js 0.160.0 and dockview-core 8.3.1 |

## Not there yet

Only Grid, TF, Laser Scan and Map exist in the new UI. The other displays, the tools, the panel
widgets (node manager, rosbag, reconfigure, diagnostics and so on), folders and icon reordering
in the touch UI, and conversion of old saved layouts come in the following plans. Until then,
use `/` for anything not listed here.

## Verification status (2026-09-30)

Checked in a browser against a live rosbridge, with two static transforms, a 2 Hz LaserScan and
an OccupancyGrid being published:

- TF, Laser Scan and Map draw at the right poses; Add → By Topic, the topic dropdown and the
  frame dropdowns list what is being published; a costmap topic starts with the Costmap scheme.
- Socket throttle changes the message rate (about 2 per second at 0 ms, one per 2 s at 2000 ms).
- Changing the fixed frame moves everything consistently.
- After the rosbridge connection drops, it reconnects and the displays keep receiving data.
- Drawing a frame with a 20,000-point scan and a 2000 x 2000 map takes under 15 ms on the
  development desktop (median under 1 ms).

Also checked: the scene, both interfaces, the toggle, the property editor, saving and restoring,
and WebGL context loss.

Not checked: a phone or tablet (touch gestures, frame rate), docking panels by mouse drag, and
returning to a tab that was in the background.

Known small issues, left for a later pass:

- A display that was disabled while the camera or TF moved is not redrawn until the next camera
  or TF change after it is enabled again.
- With a map of the wrong size arriving repeatedly, the status alternates between Ok and the error.
- A map conversion still running when the topic is changed can show the old topic's map once.
- Changing the throttle shows "No data received." until the next message.
- "Loading topics..." never ends when rosbridge is down.
- Handing a very large map to the colour-conversion worker blocks the page briefly (about
  150 ms for 2000 x 2000 cells), as the current UI does.
- In the orbit view the grid reaches far enough to alias into dots near the horizon.
- The top-down camera does not show anything more than 1000 m above the fixed frame origin.
- The existing `js/modules/tf.js` reads `stamp.secs/nsecs`, which ROS 2 does not send, so
  "nearest the message stamp" lookups return the latest transform. This affects the old UI too.
