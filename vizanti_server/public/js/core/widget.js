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

	// widgets call this when their icon (this.icon, or what buildIcon draws) changes
	refreshIcon() {
		// faces that were shown and are now gone (the other UI, a rebuilt bar) are dropped
		this._faces = (this._faces ?? []).filter((face) => face.element.isConnected || !face.shown);
		for (const face of this._faces) {
			if (face.element.isConnected) {
				face.shown = true;
				this._safe("_paintFace", face);
			}
		}
		this.onIcon?.();
	}

	// A 50×50 element showing this widget's icon, for a widget that draws its own (a gauge with
	// a needle and a reading); null for one that is a single image (this.icon). Each call makes
	// a new face, and refreshIcon repaints all of them.
	makeIconFace() {
		if (typeof this.buildIcon !== "function")
			return null;
		const element = document.createElement("span");
		element.className = "widget_face";
		const face = { element, paint: null, shown: false };
		face.paint = this.buildIcon(element) ?? null;
		this._faces = [...(this._faces ?? []), face];
		this._safe("_paintFace", face);
		return element;
	}

	_paintFace(face) {
		face.paint?.();
	}

	// override: the panel's content, built once and kept while the widget lives
	buildPanel(container) {}

	// optional override: fill `face` (a 50×50 box) with the icon's parts and return a function
	// that repaints them from the widget's state
	// buildIcon(face) { return () => {}; }

	_destroy() {
		this.detachPanel();
		super._destroy();
	}
}
