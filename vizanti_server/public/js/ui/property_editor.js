import { enumValues } from '../core/properties.js';

// entries: [{ value, label }]. A current value missing from the list stays selectable,
// so a saved topic or frame that is not there right now is not silently replaced.
function setOptions(select, entries, current) {
	const list = [...entries];
	if (!list.some((entry) => String(entry.value) === String(current)))
		list.push({ value: current, label: current === "" ? "(none)" : String(current) });

	select.replaceChildren();
	for (const entry of list) {
		const option = document.createElement("option");
		option.value = String(entry.value);
		option.textContent = entry.label;
		select.appendChild(option);
	}
	select.value = String(current);
}

function input(type) {
	const element = document.createElement("input");
	element.type = type;
	return element;
}

// Turns one property declaration into an input control.
// commit(raw) returns { ok, value } or { ok: false, error }.
export function createControl(def, value, commit, env) {
	const report = (element, raw) => {
		const result = commit(raw);
		element.classList.toggle("prop_invalid", !result.ok);
		element.title = result.ok ? "" : result.error;
		return result;
	};

	switch (def.type) {
		case "bool": {
			const element = input("checkbox");
			element.checked = value;
			element.addEventListener("change", () => report(element, element.checked));
			return element;
		}

		case "int":
		case "float": {
			const step = def.step ?? (def.type === "int" ? 1 : "any");
			if (def.slider) {
				const wrap = document.createElement("span");
				wrap.className = "prop_slider";
				const text = document.createElement("span");
				text.textContent = String(value);
				const element = input("range");
				element.min = def.min;
				element.max = def.max;
				element.step = step;
				element.value = value;
				element.addEventListener("input", () => {
					const result = report(element, element.value);
					if (result.ok)
						text.textContent = String(result.value);
				});
				wrap.append(text, element);
				return wrap;
			}
			const element = input("number");
			if (def.min !== undefined) element.min = def.min;
			if (def.max !== undefined) element.max = def.max;
			element.step = step;
			element.value = value;
			// "change", not "input": a half-typed number must not be rejected while typing
			element.addEventListener("change", () => {
				const result = report(element, element.value);
				if (result.ok)
					element.value = result.value; // shows the clamped or rounded value
			});
			return element;
		}

		case "color": {
			// the swatch alone can be hard to see (dark colours on a dark panel), so the hex goes next to it
			const wrap = document.createElement("span");
			wrap.className = "prop_color";
			const element = input("color");
			element.value = value;
			const hex = document.createElement("span");
			hex.className = "prop_color_hex";
			hex.textContent = value;
			element.addEventListener("input", () => {
				if (report(element, element.value).ok)
					hex.textContent = element.value;
			});
			wrap.append(element, hex);
			return wrap;
		}

		case "string": {
			const element = input("text");
			element.value = value;
			if (def.suggestions) {
				const list = document.createElement("datalist");
				list.id = "suggestions_" + Math.random().toString(36).slice(2);
				for (const suggestion of def.suggestions) {
					const option = document.createElement("option");
					option.value = suggestion;
					list.appendChild(option);
				}
				element.setAttribute("list", list.id);
				element.addEventListener("change", () => report(element, element.value));
				const wrap = document.createElement("span");
				wrap.append(element, list);
				return wrap;
			}
			element.addEventListener("change", () => report(element, element.value));
			return element;
		}

		case "enum": {
			const element = document.createElement("select");
			const entries = def.options.map((o) => (o !== null && typeof o === "object" ? o : { value: o, label: String(o) }));
			setOptions(element, entries, value);
			element.addEventListener("change", () => {
				const picked = enumValues(def).find((v) => String(v) === element.value);
				report(element, picked);
			});
			return element;
		}

		case "topic": {
			const element = document.createElement("select");
			setOptions(element, [], value);
			// a property may name its own message types, and service types to offer as well
			// (the Button calls a service or publishes); those entries show their type
			const refresh = async () => {
				const none = def.optional ? [{ value: "", label: "(none)" }] : [];
				if (def.anyType) {
					// every topic, of any type (the Topic Inspector)
					const all = await env.listAllTopics();
					setOptions(element, [...none, ...all.topics.map((name, i) => ({ value: name, label: `${name} (${all.types[i]})` }))], element.value);
					return;
				}
				if (!def.serviceTypes) {
					const topics = await env.listTopics(def.msgTypes ?? env.msgTypes);
					setOptions(element, [...none, ...topics.map((topic) => ({ value: topic, label: topic }))], element.value);
					return;
				}
				const short = (type) => type.replace("/msg/", "/").replace("/srv/", "/");
				const lists = await Promise.all([
					...(def.msgTypes ?? env.msgTypes).map(async (type) => (await env.listTopics([type])).map((name) => ({ value: name, label: `${name} (${short(type)})` }))),
					...def.serviceTypes.map(async (type) => (await (env.listServices?.([type]) ?? [])).map((name) => ({ value: name, label: `${name} (${short(type)})` }))),
				]);
				setOptions(element, [...none, ...lists.flat()], element.value);
			};
			element.addEventListener("focus", refresh);
			element.addEventListener("change", () => report(element, element.value));
			refresh();
			return element;
		}

		case "frame": {
			const element = document.createElement("select");
			const refresh = () => {
				const entries = env.listFrames().map((frame) => ({ value: frame, label: frame }));
				if (!def.noDefault)
					entries.unshift({ value: "", label: "<fixed_frame>" });
				setOptions(element, entries, element.options.length ? element.value : value);
			};
			element.addEventListener("focus", refresh);
			element.addEventListener("change", () => report(element, element.value));
			refresh();
			return element;
		}
	}
	return null; // "object" and "array" properties have no generated control
}

// Appends a labelled row per property. commit(key, raw) returns the same result as above.
export function renderProperties(container, schema, values, commit, env) {
	for (const [key, def] of Object.entries(schema)) {
		if (def.type === "group") {
			const heading = document.createElement("h4");
			heading.textContent = def.label ?? key;
			container.appendChild(heading);
			renderProperties(container, def.properties ?? {}, values, commit, env);
			continue;
		}

		if (def.hidden)
			continue;
		const control = createControl(def, values[key], (raw) => commit(key, raw), env);
		if (!control)
			continue;

		const row = document.createElement("div");
		row.className = "prop_row";
		const label = document.createElement("label");
		label.textContent = (def.label ?? key) + (def.unit ? ` (${def.unit})` : "") + ":";
		row.append(label, control);
		container.appendChild(row);

		// help stays out of the way: the label's tooltip, and a "?" that shows it under the row
		if (def.help) {
			label.title = def.help;
			const help = document.createElement("p");
			help.className = "comment prop_help";
			help.textContent = def.help;
			help.hidden = true;
			const toggle = document.createElement("button");
			toggle.type = "button";
			toggle.className = "prop_help_toggle";
			toggle.textContent = "?";
			toggle.title = "Show help";
			toggle.setAttribute("aria-label", `Help for ${def.label ?? key}`);
			toggle.setAttribute("aria-expanded", "false");
			toggle.addEventListener("click", () => {
				help.hidden = !help.hidden;
				toggle.setAttribute("aria-expanded", String(!help.hidden));
				toggle.title = help.hidden ? "Show help" : "Hide help";
			});
			row.appendChild(toggle);
			container.appendChild(help);
		}
	}
}
