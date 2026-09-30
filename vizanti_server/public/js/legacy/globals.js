import { openAddDialog } from '../ui/add_dialog.js';

// The functions and flags the original widget templates expect to find on the page.
export function installLegacyGlobals(app) {
	window.isMobile = /android|iphone|ipad|ipod|mobile|silk|kindle/i.test(navigator.userAgent);
	window.isTouchscreen = false;
	document.documentElement.addEventListener("touchstart", () => { window.isTouchscreen = true; }, { passive: true });
	document.documentElement.ondragstart = () => false; // Safari image dragging

	window.openModal = (id, target = "") => {
		if (id === "modal_add_element") {
			openAddDialog(app, { container: target === "icon_container" ? "" : target });
			return;
		}
		app.shell.openLegacy(id.replace(/_modal$/, ""));
	};

	window.closeModal = (id) => {
		const element = document.getElementById(id);
		if (element)
			element.style.display = "none";
	};

	window.addWidget = (type, topic = "") => app.registry.add(type, { topic });
	window.removeWidget = (uid) => app.registry.remove(uid);
	window.getTopic = (uid) => app.registry.get(uid)?.props.topic ?? "";
	window.yieldToMainThread = () => new Promise((resolve) => setTimeout(resolve, 0));

	// clicking the dimmed area around a modal closes it
	document.addEventListener("click", (event) => {
		const target = event.target;
		if (target.classList && target.classList.contains("modal_outer") && target.closest("#legacy_modals"))
			target.style.display = "none";
	});
}
