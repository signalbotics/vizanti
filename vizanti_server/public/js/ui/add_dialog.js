// Categories for the "By type" list, in display order. A display class may also declare
// `static category`; anything else lands in "Other".
const CATEGORIES = [
	["Robot", ["urdf", "robotmodel", "tf", "axes", "odom"]],
	["Sensors", ["scan", "pointcloud", "depthcloud", "camera", "image", "compressedimage", "range", "sensorvalue", "imu"]],
	["Maps and navigation", ["map", "gridcells", "path", "posearray", "posewithcovariancestamped", "pointstamped", "polygon", "wrench", "satelite"]],
	["Markers", ["marker", "markerarray", "interactivemarkers"]],
	["Scene", ["grid"]],
	["Tools", ["waypoints", "survey", "area", "initialpose", "simplegoal"]],
	["Panels and widgets", []], // every other template widget
];

function categoryOf(Cls) {
	if (typeof Cls.category === "string" && Cls.category !== "")
		return Cls.category;
	for (const [name, types] of CATEGORIES) {
		if (types.includes(Cls.type))
			return name;
	}
	return Cls.kind === "template" ? "Panels and widgets" : "Other";
}

// Every word typed must appear somewhere in the entry's text.
export function matchesQuery(text, query) {
	const haystack = text.toLowerCase();
	return query.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

// "panel" for panel plugins, "display" for everything else (displays and widgets)
export function kindOf(Cls) {
	return Cls.isPanel ? "panel" : "display";
}

// kinds: which to list, ["display"], ["panel"] or both (the touch UI's single add button)
export function openAddDialog(app, { container = "", kinds = ["display", "panel"] } = {}) {
	const onlyPanels = kinds.length === 1 && kinds[0] === "panel";
	const what = onlyPanels ? "panel" : "display";
	const outer = document.createElement("div");
	outer.className = "modal_outer noselect";
	outer.style.display = "flex";
	outer.style.zIndex = "30";

	const inner = document.createElement("div");
	inner.className = "modal_inner noselect add_dialog";
	inner.setAttribute("role", "dialog");
	inner.setAttribute("aria-label", `Add ${what}`);
	outer.appendChild(inner);

	const onKey = (event) => {
		if (event.key === "Escape") {
			event.preventDefault();
			close();
		}
	};
	const close = () => {
		outer.remove();
		document.removeEventListener("keydown", onKey, true);
	};
	document.addEventListener("keydown", onKey, true);
	outer.addEventListener("click", (event) => {
		if (event.target === outer)
			close();
	});

	const title = document.createElement("h3");
	title.textContent = `Add ${what}`;

	const search = document.createElement("input");
	search.type = "search";
	search.className = "add_search";
	search.placeholder = onlyPanels ? "Search panels…" : "Search displays, message types or topics…";
	search.setAttribute("aria-label", "Search");

	const tabs = document.createElement("div");
	tabs.className = "tab";
	const byType = document.createElement("button");
	byType.className = "tablinks active-tab";
	byType.textContent = "By Type";
	const byTopic = document.createElement("button");
	byTopic.className = "tablinks";
	byTopic.textContent = "By Topic";
	tabs.append(byType, byTopic);
	if (onlyPanels)
		tabs.style.display = "none"; // panels are not tied to a topic

	const typeBox = document.createElement("div");
	const topicBox = document.createElement("div");
	topicBox.style.display = "none";
	const empty = document.createElement("p");
	empty.className = "add_empty";
	empty.textContent = "Nothing matches.";
	empty.style.display = "none";

	const entry = (Cls, heading, text, props, searchText) => {
		const row = document.createElement("div");
		row.className = "widget_entry";
		row.tabIndex = 0;
		row.setAttribute("role", "button");
		row.dataset.search = searchText;
		const icon = document.createElement("img");
		icon.src = Cls.icon;
		icon.alt = "";
		icon.className = "card_icon";
		const card = document.createElement("div");
		card.className = "card";
		const name = document.createElement("b");
		name.className = "card_title";
		name.textContent = heading;
		const desc = document.createElement("p");
		desc.className = "card_desc";
		desc.textContent = text;
		card.append(name, desc);
		row.append(icon, card);
		const choose = () => {
			app.registry.add(Cls.type, props, { container });
			close();
		};
		row.addEventListener("click", choose);
		row.addEventListener("keydown", (event) => {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				choose();
			}
		});
		return row;
	};

	// ---- by type, in categories ----
	const groups = new Map();
	const order = [...CATEGORIES.map(([name]) => name), "Other"];
	for (const Cls of app.types.values()) {
		if (!kinds.includes(kindOf(Cls)))
			continue;
		const category = categoryOf(Cls);
		if (!groups.has(category))
			groups.set(category, []);
		const searchText = [Cls.label, Cls.description, Cls.type, category, ...(Cls.msgTypes ?? [])].join(" ");
		groups.get(category).push(entry(Cls, Cls.label, Cls.description, {}, searchText));
	}
	const sections = [];
	for (const category of [...order, ...[...groups.keys()].filter((c) => !order.includes(c))]) {
		const rows = groups.get(category);
		if (!rows)
			continue;
		const section = document.createElement("section");
		section.className = "add_section";
		const heading = document.createElement("h4");
		heading.className = "add_section_title";
		heading.textContent = category;
		const title = (row) => row.querySelector(".card_title").textContent;
		section.append(heading, ...rows.sort((a, b) => title(a).localeCompare(title(b))));
		typeBox.appendChild(section);
		sections.push(section);
	}

	if (sections.length === 0) {
		const none = document.createElement("p");
		none.className = "comment";
		none.textContent = onlyPanels
			? "No panel plugins are installed. Packages add them with a vizanti_plugins.xml (see docs/plugins.md)."
			: "Nothing to add.";
		typeBox.appendChild(none);
	}

	const activeBox = () => (typeBox.style.display === "none" ? topicBox : typeBox);

	// Hides entries (and empty categories) that do not match the search box.
	const filter = () => {
		const query = search.value.trim();
		const box = activeBox();
		let shown = 0;
		for (const row of box.querySelectorAll(".widget_entry")) {
			const visible = !query || matchesQuery(row.dataset.search, query);
			row.style.display = visible ? "" : "none";
			shown += visible ? 1 : 0;
		}
		for (const section of sections)
			section.style.display = [...section.querySelectorAll(".widget_entry")].some((row) => row.style.display !== "none") ? "" : "none";
		empty.style.display = shown === 0 && box.querySelector(".widget_entry") ? "" : "none";
	};
	search.addEventListener("input", filter);
	search.addEventListener("keydown", (event) => {
		// Enter adds the first match
		if (event.key !== "Enter")
			return;
		const first = [...activeBox().querySelectorAll(".widget_entry")].find((row) => row.style.display !== "none");
		if (first) {
			event.preventDefault();
			first.click();
		}
	});

	// ---- by topic ----
	const showTopics = async () => {
		topicBox.replaceChildren();
		const loading = document.createElement("p");
		loading.textContent = "Loading topics...";
		topicBox.appendChild(loading);

		// rosapi never answers while rosbridge is down
		const result = await Promise.race([
			app.listAllTopics(),
			new Promise((resolve) => setTimeout(() => resolve(null), 5000)),
		]);
		if (!result) {
			loading.textContent = "The topic list did not arrive. Is rosbridge connected?";
			return;
		}
		topicBox.replaceChildren();
		for (let i = 0; i < result.topics.length; i++) {
			for (const Cls of app.types.values()) {
				if (kinds.includes(kindOf(Cls)) && Cls.msgTypes.includes(result.types[i])) {
					const searchText = [result.topics[i], result.types[i], Cls.label].join(" ");
					topicBox.appendChild(entry(Cls, result.topics[i], `${Cls.label} (${result.types[i]})`,
						Cls.propsForTopic(result.topics[i], result.types[i]), searchText));
				}
			}
		}
		if (topicBox.children.length === 0) {
			const none = document.createElement("p");
			none.textContent = "No topic is being published that any display here can show.";
			topicBox.appendChild(none);
		}
		filter();
	};

	byType.addEventListener("click", () => {
		byType.classList.add("active-tab");
		byTopic.classList.remove("active-tab");
		typeBox.style.display = "block";
		topicBox.style.display = "none";
		filter();
	});
	byTopic.addEventListener("click", () => {
		byTopic.classList.add("active-tab");
		byType.classList.remove("active-tab");
		typeBox.style.display = "none";
		topicBox.style.display = "block";
		showTopics();
	});

	inner.append(title, search, tabs, typeBox, topicBox, empty);
	document.body.appendChild(outer);
	search.focus();
}
