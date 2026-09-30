// Named layouts kept on the robot, so every browser that opens Vizanti can use them.

const NAME = /^[\w-]{1,64}$/;

export function validConfigName(name) {
	return typeof name === "string" && NAME.test(name);
}

// fetchImpl has the shape of window.fetch
export function createConfigClient(fetchImpl, baseUrl) {
	const call = async (method, path, body) => {
		let response;
		try {
			response = await fetchImpl(`${baseUrl}/configs${path}`, body === undefined ? { method } : {
				method,
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
		} catch (e) {
			throw new Error("The Vizanti server could not be reached.");
		}
		let data = null;
		try {
			data = await response.json();
		} catch (e) { /* no body */ }
		if (!response.ok)
			throw new Error(data?.error ?? `The server answered ${response.status}.`);
		return data;
	};

	const named = (name) => {
		if (!validConfigName(name))
			throw new Error("A config name may only contain letters, digits, - and _ (at most 64).");
		return "/" + name;
	};

	return {
		async list() { return (await call("GET", "")).configs; },
		async load(name) { return call("GET", named(name)); },
		async save(name, layout) { return call("PUT", named(name), layout); },
		async remove(name) { return call("DELETE", named(name)); },
	};
}
