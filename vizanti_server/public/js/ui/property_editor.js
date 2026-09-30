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
			const element = input("color");
			element.value = value;
			element.addEventListener("input", () => report(element, element.value));
			return element;
		}

		case "string": {
			const element = input("text");
			element.value = value;
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
			const refresh = async () => {
				const topics = await env.listTopics(env.msgTypes);
				setOptions(element, topics.map((topic) => ({ value: topic, label: topic })), element.value);
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
	return null; // "object" properties have no generated control
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

		const control = createControl(def, values[key], (raw) => commit(key, raw), env);
		if (!control)
			continue;

		const row = document.createElement("div");
		row.className = "prop_row";
		const label = document.createElement("label");
		label.textContent = (def.label ?? key) + (def.unit ? ` (${def.unit})` : "") + ":";
		row.append(label, control);
		container.appendChild(row);

		if (def.help) {
			const help = document.createElement("p");
			help.className = "comment";
			help.textContent = def.help;
			container.appendChild(help);
		}
	}
}
