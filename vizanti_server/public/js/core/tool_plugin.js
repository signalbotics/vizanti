// Base class of a tool plugin: a button in the RViz UI's tool row (added with its "+"), and in
// the touch UI's tool list. While it is the active tool it gets the 3D view's pointer.
//
//   static type        set by the plugin loader from the plugin description ("pkg/Name")
//   static label, icon, description   likewise, unless the class sets them
//   static key         a one-letter shortcut, optional
//   static hint        shown at the top of the view while the tool is active
//
// this.api: publish(topic, type, msg), callService(name, type, request), action(name, type) (as ctx.action),
// pick(x, y) / ground(x, y) (the point under the pointer; client px), scene, tf,
// fixedFrame(), header() (a std_msgs/Header in the fixed frame, now), requestRender(), notify(text),
// and done(), which hands the view back to Move Camera.
export class ToolPlugin {

	static type = "";
	static label = "";
	static icon = "";
	static description = "";
	static key = "";
	static hint = "";

	constructor(api) {
		this.api = api;
	}

	onActivate() {}
	onDeactivate() {}

	// kind: "down" | "move" | "up"; event: the PointerEvent (clientX, clientY, button, shiftKey...)
	onPointer(kind, event) {}

	// draws on the view's 2D overlay while active (CSS px)
	onOverlay(ctx, view) {}
}
