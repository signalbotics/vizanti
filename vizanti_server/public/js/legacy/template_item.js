import { DisplayStatus } from '../core/display.js';

function fill(html, id) {
	return html.replaceAll("{uniqueID}", id);
}

function wrap(html, id) {
	const element = document.createElement("div");
	element.dataset.uniqueid = id;
	element.innerHTML = fill(html, id);
	return element;
}

// Builds a registry item class for a widget that still runs from its original template
// (icon, modal, view and script with {uniqueID} placeholders). The template's script keeps
// its own state and subscriptions; this class only hosts its DOM and stores its saved state.
//   template: { icon, modal?, view?, script? }   hosts: ctx.legacy = { icons, modals, views, scripts }
export function makeTemplateClass(type, template, meta = {}) {
	return class TemplateItem {

		static kind = "template";
		static type = type;
		static label = meta.label ?? type;
		static icon = meta.icon ?? "assets/add.svg";
		static description = meta.description ?? "";
		static msgTypes = meta.msgTypes ?? [];
		static properties = {
			topic: { type: "string" },
			state: { type: "object" },
		};

		static propsForTopic(topic) {
			return { topic };
		}

		constructor(id, ctx) {
			this.id = id;
			this.ctx = ctx;
			this.name = TemplateItem.label;
			this.props = {};
			this.enabled = true;
			this.info = {};
			this.status = new DisplayStatus();
			this.onInfo = null;
			this.iconElement = null;
			this.modalElement = null;
			this.viewElement = null;
			this.scriptElement = null;
		}

		get icon() {
			return TemplateItem.icon;
		}

		_safe() {}
		_setOrder() {}

		_create(values, enabled) {
			this.props = { ...values };
			this.enabled = enabled;
			const hosts = this.ctx.legacy;

			this.iconElement = wrap(template.icon ?? "", this.id);
			hosts.icons.appendChild(this.iconElement);

			if (template.modal) {
				const holder = wrap(template.modal, this.id);
				hosts.modals.appendChild(holder);
				this.modalHolder = holder;
				this.modalElement = holder.querySelector(".modal_outer") ?? holder.firstElementChild;
			}

			if (template.view) {
				this.viewElement = wrap(template.view, this.id);
				// tool canvases are drawn in window coordinates and cover the whole window
				for (const canvas of this.viewElement.querySelectorAll(":scope > canvas")) {
					if (canvas.style.pointerEvents === "none" && !canvas.className)
						canvas.classList.add("legacy_fullscreen");
				}
				hosts.views.appendChild(this.viewElement);
			}

			this._applyEnabled();

			if (template.script) {
				this.scriptElement = document.createElement("script");
				this.scriptElement.type = "module";
				this.scriptElement.dataset.uniqueid = this.id;
				this.scriptElement.textContent = fill(template.script, this.id);
				hosts.scripts.appendChild(this.scriptElement);
			}
		}

		_applyEnabled() {
			if (this.viewElement)
				this.viewElement.style.display = this.enabled ? "" : "none";
		}

		_setProperty(key, value) {
			this.props[key] = value;
		}

		_setEnabled(enabled) {
			this.enabled = enabled;
			this._applyEnabled();
		}

		_destroy() {
			for (const element of [this.iconElement, this.modalHolder, this.modalElement, this.viewElement, this.scriptElement]) {
				if (element)
					element.remove();
			}
			for (const element of document.querySelectorAll(`[data-uniqueid="${CSS.escape(this.id)}"]`))
				element.remove();
		}
	};
}
