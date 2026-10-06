import { Display } from './display.js';

// Properties every widget has; spread into a widget's own `static properties`.
export const WIDGET_PROPERTIES = {
	show_panel: { type: "bool", default: false, hidden: true }, // its panel is open (RViz UI)
};

// A widget: a live icon (battery level, a gauge…) and a panel with its readouts or controls,
// rather than (or as well as) something drawn in the 3D view. The RViz UI shows the icon in the
// toolbar's widget strip and the panel as a dock panel; the touch UI shows the icon in its bar
// and the panel at the top of the widget's modal.
export class WidgetDisplay extends Display {

	static widget = true;

	// the shells call these
	get wantsPanel() {
		return !!this.props.show_panel;
	}

	togglePanel(open = !this.props.show_panel) {
		this.setProp("show_panel", open);
	}

	attachPanel(host) {
		if (!this.panelElement) {
			this.panelElement = document.createElement("div");
			this.panelElement.className = "widget_panel";
			this._safe("buildPanel", this.panelElement);
		}
		this.panelHost = host;
		host.appendChild(this.panelElement);
	}

	detachPanel() {
		this.panelElement?.remove();
		this.panelHost = null;
	}

	// widgets call this when their icon (this.icon) changes
	refreshIcon() {
		this.onIcon?.();
	}

	// override: the panel's content, built once and kept while the widget lives
	buildPanel(container) {}

	_destroy() {
		this.detachPanel();
		super._destroy();
	}
}
