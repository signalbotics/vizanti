import { WidgetDisplay, WIDGET_PROPERTIES } from './widget.js';

// Base class of a panel plugin, like an RViz panel: a dock panel in the RViz UI (Panels → Add
// panel; closing it removes it, as in RViz) and an icon that opens it in the touch UI.
// Build its content in buildPanel(container); declare its saved settings in `static properties`
// (spread WIDGET_PROPERTIES in, as widgets do). Everything a display can do, it can do.
export class PanelPlugin extends WidgetDisplay {

	static isPanel = true;

	// always shown while it exists
	get wantsPanel() {
		return true;
	}
}

export { WIDGET_PROPERTIES };
