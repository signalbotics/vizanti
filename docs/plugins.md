# Writing Vizanti plugins

Any ROS package can add **displays**, **panels** and **tools** to Vizanti, the way RViz plugins
add them to RViz. You write JavaScript classes, declare them in a pluginlib-style XML file, and
export it from CMake. After you build and source the workspace and restart the Vizanti server,
they appear:

| Kind | Base class | Where it shows up |
|---|---|---|
| Display | `Display` (or `WidgetDisplay`) | Add display, under the package's name, as in RViz's "By display type" |
| Panel | `PanelPlugin` | Main menu → Add panel… (RViz UI: a dock panel; touch UI: an icon in the bar) |
| Tool | `ToolPlugin` | The "+" after the tools in the RViz UI's toolbar; every tool in the touch UI's Tools list |

`vizanti_demos` ships one of each: `vizanti/displays/frame_label.js`,
`vizanti/panels/text_log.js` and `vizanti/tools/drop_pin.js`, with `vizanti_plugins.xml`.
`vizanti_nav2` is a full real-world example: all seven `nav2_rviz_plugins` classes, with their
logic split out for unit tests (see `vizanti_nav2/README.md`); `vizanti_moveit` does the same
for MoveIt's four displays (`vizanti_moveit/README.md`).

## 1. Declare the classes

`vizanti_plugins.xml` at the package root uses the same format as an RViz
`plugin_description.xml`:

```xml
<library path="my_package">
  <class name="my_package/Battery Graph" type="displays/battery_graph.js#BatteryGraph"
         base_class_type="vizanti::Display" rviz_class="some_pkg/BatteryGraph">
    <description>Plots the battery voltage over time.</description>
  </class>
</library>
```

| Attribute | Meaning |
|---|---|
| `name` | `<package>/<Name>`, as in RViz. It is also the class's type in saved layouts, so keep it stable. |
| `type` | The JavaScript module under `share/<package>/vizanti/`, then `#` and the exported class. Without `#…`, the module's only class extending the base is used. |
| `base_class_type` | `vizanti::Display`, `vizanti::Panel` or `vizanti::Tool`. |
| `rviz_class` | Optional. Importing a `.rviz` config maps that RViz class onto this one, so a config that used the RViz plugin loads with yours. A static `fromRviz(entry)` on the class can read the RViz entry's settings into your properties. |
| `<description>` | Shown in the Add dialog. |

**Icons**: put `icons/classes/<Name>.svg` (or `.png`) in the package, as RViz does. `<Name>` is
the part of `name` after the `/`. Tools use the icon as a mask, so draw them in one colour.

## 2. Install and export it

In `CMakeLists.txt`:

```cmake
find_package(pluginlib REQUIRED)

install(DIRECTORY vizanti icons DESTINATION share/${PROJECT_NAME}/)
pluginlib_export_plugin_description_file(vizanti_server vizanti_plugins.xml)
```

In `package.xml`: `<build_depend>pluginlib</build_depend>` and
`<exec_depend>vizanti_server</exec_depend>`.

`pluginlib_export_plugin_description_file` registers the ament resource
`vizanti_server__pluginlib__plugin`. The server reads it to find your XML, and serves your
`vizanti/` folder at `/plugins/<package>/` and your icons at `/plugin_icons/<package>/`. Only
`.js`, `.css`, `.svg`, `.png` and `.json` files are served.

## 3. Write the classes

Import the framework through the `@vizanti/` import map entry:

```js
import { Display, WidgetDisplay, PanelPlugin, ToolPlugin, WIDGET_PROPERTIES } from '@vizanti/plugin_api.js';
```

`API_VERSION` (now `1`) is exported too. Three.js is available as `import * as THREE from 'three'`.

### Displays

Write them like the built-in ones (`docs/ui.md`, "Add a display"):
- `static properties` (the settings, which the UI generates editors for);
- `static msgTypes`;
- the `on*` hooks (`onCreate`, `onMessage`, `onPropertyChange`, `onTfChange`, `onOverlay`,
  `onDestroy`, ...).

The base class subscribes to `props.topic`, places `this.root` at frames, and keeps the status.
Widgets (a live toolbar icon plus a panel) extend `WidgetDisplay`.

A display can also have a dock panel of its own, as RViz's MotionPlanning display does
(`vizanti_moveit/vizanti/displays/motion_planning.js`). To do this:
- set `static ownPanel = true`;
- have `get wantsPanel()` return true while the panel should be open;
- in `attachPanel(host)`, put the panel's element into `host`, and remove it in `detachPanel()`;
- `onPanelClosed()` runs when the user closes the dock panel. Without it, closing the panel
  disables the display.
- `static panelDirection` says where the panel first opens next to the 3D view: `"right"` (the
  default), `"below"`, or `"tab"`, as a tab beside it (the Plot panel does this). Panels with the
  same placement open as tabs of one another.

### Panels

```js
export class TextLogPanel extends PanelPlugin {
	static msgTypes = ["std_msgs/msg/String"];
	static properties = {
		topic: { type: "topic", label: "Topic", default: "/chatter" },
		...WIDGET_PROPERTIES,
	};
	onMessage(msg) { /* keep it, then repaint */ }
	buildPanel(container) { /* build the panel's DOM once */ }
}
```

A panel is a `WidgetDisplay` that is always open:
- it can subscribe, publish (`this.ctx.publish`), call services (`this.ctx.callService`) and
  keep settings like any display;
- its settings appear in a folded "Settings" section at its top;
- it is not listed among the displays;
- closing its dock panel removes it, as in RViz.

### Tools

```js
export class DropPinTool extends ToolPlugin {
	static key = "i"; // optional shortcut
	static hint = "Click the ground to drop a pin.";
	onPointer(kind, event) {          // "down" | "move" | "up"
		if (kind !== "up") return;
		const point = this.api.ground(event.clientX, event.clientY);
		if (point) this.api.publish("/dropped_pins", "geometry_msgs/msg/PointStamped", { header: this.api.header(), point });
	}
	onOverlay(ctx, view) { /* draw while active; view.project(x, y, z) -> screen */ }
}
```

`this.api` gives a tool:
- `publish`, `callService`, `action`, `listServices(type)`;
- `pick(x, y)` (the solid point under the pointer) and `ground(x, y)`;
- `scene`, `tf`, `fixedFrame()`, `header()`;
- `requestRender()`, `notify(text)`;
- `done()`, which hands the view back to Move Camera, as RViz's pose tools do after one use.

`onActivate()` and `onDeactivate()` run when the tool is chosen and left. While a tool is active
it gets the view's pointer and the camera does not move. Which plugin tools are in the toolbar
is saved with the layout, like RViz's tool list.

### Talking to ROS

Displays and panels have `this.ctx`, and tools have `this.api` with the same calls:

| Call | What it does |
|---|---|
| `publish(topic, type, msg)` | publishes one message (the publisher is kept) |
| `callService(name, type, request, timeoutMs = 5000)` | resolves with the response; rejects on failure or timeout |
| `action(name, type)` | a ROS 2 action client (see below) |
| `listNodes()`, `listServices(type)`, `listAllTopics()`, `topicInfo(topic)` | what is on the ROS graph (displays and panels; tools have `listServices`) |
| `subscribe(topic, type, throttleMs, callback, qos, { queueLength })` | an extra subscription, returning its unsubscribe function; `queueLength` (default 1, the latest message only) lets rosbridge queue more, for a plugin that needs every message (displays and panels) |
| `rosTime()` | ROS time in seconds, following `/clock` in simulation (displays and panels) |
| `notify(text)` | a short notice at the top of the page (displays and panels) |

A display's or panel's `topic` property is subscribed to by the base class (its `onMessage` gets
the messages).

**Actions.** `send` returns `{ result, cancel() }`:

```js
const nav = this.ctx.action("/navigate_to_pose", "nav2_msgs/action/NavigateToPose");
const goal = nav.send({ pose, behavior_tree: "" }, { onFeedback: (f) => this.showEta(f.estimated_time_remaining) });
const { status, values, ok } = await goal.result; // status: "succeeded", "aborted", "canceled", ...
goal.cancel();
```

`ok` is false when rosbridge could not run the goal at all (no action server, or the connection
dropped); `values` is then the error text.

## The older form

Packages that register the ament resource `vizanti_displays` and install
`share/<package>/vizanti/displays/*.js` (each class with its own `static type`) still load, as
displays only. A package with a `vizanti_plugins.xml` is read from that file instead.

## When something does not load

- The server logs every problem it finds in a plugin description (`Plugin: …`), for example a
  `type` file that is not installed or an unknown `base_class_type`.
- The page shows a notice for a module that fails to import, or that does not export a class of
  the right kind.
- Restart the server after installing or changing a plugin package. Reload the page after
  editing a module.
