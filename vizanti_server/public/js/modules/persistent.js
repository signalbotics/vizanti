// Compatibility layer for widgets written against the old settings object.
// settings[widgetId] reads and writes that widget's saved state in the display registry;
// settings.save() asks the app to persist the layout.
export function saveJsonToFile(data, filename) {
	const jsonData = JSON.stringify(data, null, 2);
	const blob = new Blob([jsonData], { type: 'application/json' });
	const url = URL.createObjectURL(blob);

	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();

	URL.revokeObjectURL(url);
}

function item(id) {
	return typeof id === "string" ? window.vizanti.registry.get(id) : undefined;
}

function hasState(id) {
	const found = item(id);
	return !!found && found.props.state !== undefined && Object.keys(found.props.state).length > 0;
}

export let settings = new Proxy({}, {
	get(target, key) {
		if (key === "save")
			return () => window.vizanti.requestSave();
		if (key === "hasOwnProperty")
			return (id) => hasState(id);
		return hasState(key) ? item(key).props.state : undefined;
	},
	set(target, key, value) {
		const found = item(key);
		if (found)
			found.props.state = value;
		return true;
	},
	has(target, key) {
		return hasState(key);
	},
	deleteProperty(target, key) {
		const found = item(key);
		if (found)
			found.props.state = {};
		return true;
	},
});
