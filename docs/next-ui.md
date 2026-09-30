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
