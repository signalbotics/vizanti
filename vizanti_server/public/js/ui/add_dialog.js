export function openAddDialog(app) {
	const outer = document.createElement("div");
	outer.className = "modal_outer noselect";
	outer.style.display = "flex";
	outer.style.zIndex = "30";

	const inner = document.createElement("div");
	inner.className = "modal_inner noselect";
	outer.appendChild(inner);

	const close = () => outer.remove();
	outer.addEventListener("click", (event) => {
		if (event.target === outer)
			close();
	});

	const title = document.createElement("h3");
	title.textContent = "Add Widgets";

	const tabs = document.createElement("div");
	tabs.className = "tab";
	const byType = document.createElement("button");
	byType.className = "tablinks active-tab";
	byType.textContent = "By Type";
	const byTopic = document.createElement("button");
	byTopic.className = "tablinks";
	byTopic.textContent = "By Topic";
	tabs.append(byType, byTopic);

	const typeBox = document.createElement("div");
	const topicBox = document.createElement("div");
	topicBox.style.display = "none";

	const entry = (Cls, heading, text, props) => {
		const row = document.createElement("div");
		row.className = "widget_entry";
		const icon = document.createElement("img");
		icon.src = Cls.icon;
		icon.alt = Cls.label;
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
		row.addEventListener("click", () => {
			app.registry.add(Cls.type, props);
			close();
		});
		return row;
	};

	for (const Cls of app.types.values())
		typeBox.appendChild(entry(Cls, Cls.label, Cls.description, {}));

	const showTopics = async () => {
		topicBox.replaceChildren();
		const loading = document.createElement("p");
		loading.textContent = "Loading topics...";
		topicBox.appendChild(loading);

		const result = await app.listAllTopics();
		topicBox.replaceChildren();
		for (let i = 0; i < result.topics.length; i++) {
			for (const Cls of app.types.values()) {
				if (Cls.msgTypes.includes(result.types[i]))
					topicBox.appendChild(entry(Cls, result.topics[i], `${Cls.label} (${result.types[i]})`, Cls.propsForTopic(result.topics[i])));
			}
		}
		if (topicBox.children.length === 0) {
			const none = document.createElement("p");
			none.textContent = "No topic is being published that any display here can show.";
			topicBox.appendChild(none);
		}
	};

	byType.addEventListener("click", () => {
		byType.classList.add("active-tab");
		byTopic.classList.remove("active-tab");
		typeBox.style.display = "block";
		topicBox.style.display = "none";
	});
	byTopic.addEventListener("click", () => {
		byTopic.classList.add("active-tab");
		byType.classList.remove("active-tab");
		typeBox.style.display = "none";
		topicBox.style.display = "block";
		showTopics();
	});

	inner.append(title, tabs, typeBox, topicBox);
	document.body.appendChild(outer);
}
