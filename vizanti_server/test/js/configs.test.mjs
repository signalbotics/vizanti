import test from 'node:test';
import assert from 'node:assert/strict';
import { validConfigName, createConfigClient } from '../../public/js/core/configs.js';

function fakeFetch(routes) {
	const calls = [];
	const fetchImpl = async (url, options = {}) => {
		calls.push([options.method ?? "GET", url, options.body]);
		const route = routes[`${options.method ?? "GET"} ${url}`];
		if (!route)
			return { ok: false, status: 404, json: async () => ({ error: "not found" }) };
		return { ok: route.status === undefined || route.status < 400, status: route.status ?? 200, json: async () => route.body };
	};
	return { fetchImpl, calls };
}

test('config names are short plain names', () => {
	for (const good of ["robot", "lab-2", "my_config_01"])
		assert.equal(validConfigName(good), true, good);
	for (const bad of ["", "a b", "../x", "a/b", "x.json", "a".repeat(65), null, 5])
		assert.equal(validConfigName(bad), false, String(bad));
});

test('list, load, save and remove use the server routes', async () => {
	const layout = { version: 2, items: [] };
	const { fetchImpl, calls } = fakeFetch({
		"GET /viz/configs": { body: { configs: ["a", "b"] } },
		"GET /viz/configs/a": { body: layout },
		"PUT /viz/configs/new": { body: { saved: "new" } },
		"DELETE /viz/configs/a": { body: { deleted: "a" } },
	});
	const client = createConfigClient(fetchImpl, "/viz");
	assert.deepEqual(await client.list(), ["a", "b"]);
	assert.deepEqual(await client.load("a"), layout);
	await client.save("new", layout);
	await client.remove("a");
	assert.deepEqual(calls.map((c) => c[0] + " " + c[1]), ["GET /viz/configs", "GET /viz/configs/a", "PUT /viz/configs/new", "DELETE /viz/configs/a"]);
	assert.equal(calls[2][2], JSON.stringify(layout));
});

test('bad names never reach the server, and server errors carry their message', async () => {
	const { fetchImpl, calls } = fakeFetch({ "PUT /configs/full": { status: 507, body: { error: "disk full" } } });
	const client = createConfigClient(fetchImpl, "");
	await assert.rejects(() => client.save("../etc", {}), /letters, digits/);
	await assert.rejects(() => client.load("a b"), /letters, digits/);
	assert.equal(calls.length, 0);
	await assert.rejects(() => client.save("full", {}), /disk full/);
	await assert.rejects(() => client.load("missing"), /not found/);
});

test('a server that cannot be reached gives a readable error', async () => {
	const client = createConfigClient(async () => { throw new TypeError("Failed to fetch"); }, "");
	await assert.rejects(() => client.list(), /could not be reached/);
});
