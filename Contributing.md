# Contributing to Vizanti

Got an idea on how to improve Vizanti?

Contrbutions are of course welcome, feel free to fork and submit PRs for any fixes or extra widgets you find useful.

## Overview

Vizanti is split into the Python ROS-side server and the web browser client.

### Server

The static content is served using Flask, with Jinja2 as the template engine. ROS related communications go through Rosbridge and Rosapi.

[server.py](vizanti_server/scripts/server.py) also serves robot configs (`/configs`), mesh and texture files from ROS packages (`/package/...`) and display plugins from other packages (`/plugins/...`).

There are also two ROS nodes that provide additional functionality not covered by Rosbridge.

[service_handler.py](vizanti_server/scripts/service_handler.py)

[tf_consolidator.cpp](vizanti_cpp/src/tf_consolidator.cpp)

### Client

The front end is plain JavaScript ES modules with no build step; libraries (three.js, dockview, roslib, …) are vendored in [vizanti_server/public/js/lib](vizanti_server/public/js/lib). One three.js scene is shared by two interfaces: the RViz-style desktop UI and the touch UI.

| Folder | What is in it |
|---|---|
| `js/core/` | App start-up, the display registry, the 3D scene, TF frames, tools, QoS, configs |
| `js/displays/` | One file per native 3D display (map, scan, point cloud, URDF, markers, …) |
| `js/geometry/` | Pure message-to-geometry functions, unit-tested in Node |
| `js/ui/` | The two interfaces, the property editor, menus and dialogs |
| `js/legacy/` | Hosting for the widgets that still run from their original templates |
| `js/modules/` | TF and rosbridge, plus compatibility shims for template widgets |

[docs/ui.md](docs/ui.md) is the user and developer guide; [docs/packaging.md](docs/packaging.md) covers the Debian packages.

---

## Adding a display (preferred)

New features should be native displays: one ES module in `vizanti_server/public/js/displays/` exporting a class that extends `Display` and declares its properties. Both interfaces, saving and the property editor are generated from that declaration. See ["Add a display"](docs/ui.md#add-a-display) in the guide, and ["Display plugins from other packages"](docs/ui.md#display-plugins-from-other-packages) to ship a display in your own ROS package without changing Vizanti.

Put the message-to-geometry logic in `js/geometry/` as pure functions with tests in `vizanti_server/test/js/`, and run the tests before sending a change:

```bash
cd vizanti_server && node --test "test/js/*.test.mjs"
```

---

## Template widgets (legacy)

About 20 widgets (teleop, battery, waypoints, …) still run from their original templates through a compatibility layer in `js/legacy/`. The rest of this guide describes that template format, for maintaining them; new features should be native displays (above).

Upon client load, the server collects all widget templates in [vizanti_server/public/templates](vizanti_server/public/templates) and sends them to the client, where [js/legacy/](vizanti_server/public/js/legacy) instantiates them. As per the existing examples, the suported files are:

- `name_icon.html` The mandatory icon element that will be added to the taskbar.

- `name_modal.html` A popup window element that is used to select the topic and change any settings.

- `name_view.html` A canvas layer for drawing visualizers. Define the Z-order value so that your element is rendered in the right order. Canvases of the same type of widget will be rendered in the order they were added.

- `name_script.js` A JS module that can import helper singletons from [vizanti_server/public/js/modules](vizanti_server/public/js/modules).

To appear in the Add dialog, a template widget needs an entry in [js/legacy/catalog.js](vizanti_server/public/js/legacy/catalog.js) (label, icon, description and accepted message types).

Any required assets should be put into [vizanti_server/public/assets](vizanti_server/public/assets). Any SVG icons that need to display a colour change using utilModule.setIconColor need to have specific elements tagged as id="fillColor" or id="strokeColor" depending on which part needs coloring.

### {uniqueID}

Every widget should have the string "{uniqueID}" embedded in its code, which will be replaced with a unique sequential identifier (e.g. "auto53") at widget instantiation, so all of those scattered elements above can have direct references to each other and a unique tag for saving settings.

As an example:
```javascript
//battery_icon.html
<div id="{uniqueID}_icon" class="icon noselect">
	<img src="assets/battery_unknown.svg" alt="?" width="50" height="50" onclick="openModal('{uniqueID}_modal')">
</div> 
```
Which can then be obtained from the script as follows:

```javascript
//battery_script.html
const icon = document.getElementById("{uniqueID}_icon");
icon.src = "something.png"
```


-----

## Helper Singletons

Quaternion.js and Roslib.js are loaded globally. There are also two global functions to streamline opening and closing models, the aptly named `openModal(widget_id+"_modal")` and `closeModal(widget_id+"_modal")` defined in [js/legacy/globals.js](vizanti_server/public/js/legacy/globals.js). Typically called when an icon is clicked.

### View

```javascript
let viewModule = await import(`${base_url}/js/modules/view.js`);
let view = viewModule.view;
```
A compatibility shim: it projects the fixed frame's ground plane (z = 0) through the 3D camera, so template widgets keep drawing in 2D on an overlay above the 3D view.

Example:

```javascript
const img_width = view.getMapUnitsInPixels(width_meters);
const img_height = view.getMapUnitsInPixels(length_meters);

let pos = view.fixedToScreen({
    x: object.translation.x,
    y: object.translation.y,
});

ctx.translate(pos.x, pos.y);
ctx.drawImage(img, -img_width/2, -img_height/2, img_width, img_height);
```

It fires off events when the screen is updated as a rendering callback.

```javascript
window.addEventListener("view_changed", drawWidget);
```   
-----


### TF Transforms

```javascript
let tfModule = await import(`${base_url}/js/modules/tf.js`);
let tf = tfModule.tf;
```
An implementation of the TF graph that gets grouped TF data at 30 fps from the`/vizanti/tf_consolidated` topic.

Example:

```javascript
//global rendering frame, as selected in global options
tf.fixed_frame

//absoluteTransforms provides all known frames transformed to the global fixed frame for quick rendering
const absolute_frame = tf.absoluteTransforms["base_link"];
absolute_frame.translation // Vector3
absolute_frame.rotation // Quaternion

//getting the radians yaw for top down rendering
let yaw = absolute_frame.rotation.toEuler().h;

//transforms provides the relative parent-child transforms as given by TF
const relative_frame = tf.transforms["base_link"];
relative_frame.parent //"odom", most likely
```

Like the view, it fires off events when the screen is updated as a rendering callback.
```javascript
window.addEventListener("tf_changed", drawWidget);
```

-----

### Rosbridge

```javascript
let rosbridgeModule = await import(`${base_url}/js/modules/rosbridge.js`);
let rosbridge = rosbridgeModule.rosbridge;
```
Wrapper for roslib.js, used for communicating with ROS.

Example:

```javascript
//all running nodes
let nodes = await rosbridge.get_all_nodes();

//all topics
let topics = await rosbridge.get_all_topics();

//all topics of specified type
let specific_topics = await rosbridge.get_topics("sensor_msgs/NavSatFix");

//built in function to get the topic name passed by the widget creator
let topic = getTopic("{uniqueID}");

roslib_topic = new ROSLIB.Topic({
    ros : rosbridge.ros,
    name : topic,
    messageType : 'sensor_msgs/LaserScan',
    throttle_rate: 30, //minium ms between messages, alleviates congestion but does not guarantee that all messages will be received
    compression: "cbor" //compression for higher throughput topics
});

listener = roslib_topic.subscribe((msg) => {	
    console.log(msg.data)
});
```

-----
### Settings

```javascript
let persistentModule = await import(`${base_url}/js/modules/persistent.js`);
let settings = persistentModule.settings;
```

Provides a localStorage object for saving widget settings.


Example:
```javascript
//if there's saved data, we fetch it upon module load
if(settings.hasOwnProperty("{uniqueID}")){
	const loaded_data  = settings["{uniqueID}"];
	topic = loaded_data.topic;
	something = loaded_data.something;
	checkbox.checked = loaded_data.checkbox;
}

function saveSettings(){
	settings["{uniqueID}"] = {
		topic: topic,
		something: input.value,
		checkbox: checkbox.checked
	}
	settings.save();
}

//on input change
saveSettings();
```

-----
### Util

```javascript
let utilModule = await import(`${base_url}/js/modules/util.js`);
let imageToDataURL = utilModule.imageToDataURL;
```   
The util class provides utility functions, the only one right now being imageToDataURL for persistent image loading that doesn't trigger new server requests upon changing an Image .src param.

```javascript
const persistent_image = await imageToDataURL("assets/image.svg");
```   
-----
### Status

```javascript
let StatusModule = await import(`${base_url}/js/modules/status.js`);
let Status = StatusModule.Status;
```   
A helper class that emulates the status indicator from rviz for each widget.

First, add this element to the widget's modal, the current convention is directly below the title text.
```html
<p id="{uniqueID}_status" class="status">Status: Ok.</p>

```

Then instantiate the class and pass it the icon and status elements:

```javascript
//by default the status is "Ok" as defined in the html
let status = new Status(
	document.getElementById("{uniqueID}_icon"),
	document.getElementById("{uniqueID}_status")
);

//show an errpr
status.setError("Empty topic.");

//show a warning
status.setWarn("No data received.");

//everything should be working fine
status.setOK();
```   

-----
### Joysticks

```javascript
let joystickModule = await import(`${base_url}/js/modules/joystick.js`);
let nipplejs = joystickModule.nipplejs;
```   

Joystick.js is a module wrapper for nipple.js. Example usage in [teleop:script.js](vizanti_server/public/templates/teleop/teleop_script.js)

-----
### Satelite Tiles

```javascript
let navsatModule = await import(`${base_url}/js/modules/navsat.js`);
let navsat = navsatModule.navsat;
```   
A module for downloading, storing, and loading slippy map tiles, mainly for use in [satelite_script.js](vizanti_server/public/templates/satelite/satelite_script.js).

Example:
```javascript
const tileURL = "https://tile.openstreetmap.org/19/123/254.png"

let tileImage = navsat.live_cache[tileURL];

//could be a placeholder if we're still loading, or not downloaded yet, in which case fetch it
if(!tileImage || !tileImage.complete){
    tileImage = placeholder;
    navsat.enqueue(tileURL);
}

//lattitude and longitude to coordinate tile indices
let tile_coords = navsat.coordToTile(longitude, latitude, zoomLevel)

//and the reverse, gets the bottom left corner of the tile
let tile_fix = navsat.tileToCoord(x, y, zoomLevel);

//distance between two points on a sphere
let distance_meters = navsat.haversine(latitude_a, longitude_a, latitude_b, longitude_b);
```   

More general info:

https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames

https://github.com/nobleo/rviz_satellite

-----

    