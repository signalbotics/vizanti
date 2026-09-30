// The choice of UI is per browser, so it is stored apart from the exportable layout.
export const UI_KEY = "vizanti_ui";

const SHELLS = ["rviz", "touch"];
const NARROW_WIDTH = 900;

// query: location.search, stored: the remembered choice or null,
// width: window width in CSS px, coarsePointer: true for touch-first devices
export function chooseShell({ query, stored, width, coarsePointer }) {
	const requested = new URLSearchParams(query).get("ui");
	if (SHELLS.includes(requested))
		return requested;
	if (SHELLS.includes(stored))
		return stored;
	return width < NARROW_WIDTH || coarsePointer ? "touch" : "rviz";
}
