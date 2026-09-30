import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorage, STORAGE_KEY } from '../../public/js/core/storage.js';

function memory(initial = {}) {
	const data = { ...initial };
	return {
		data,
		getItem: (k) => (k in data ? data[k] : null),
		setItem: (k, v) => { data[k] = String(v); },
		removeItem: (k) => { delete data[k]; },
	};
}

const layout = { version: 2, uid: 1, global: {}, ui: {}, items: [] };

test('the storage key is separate from the old UI', () => {
	assert.equal(STORAGE_KEY, "vizanti_v2");
});

test('load returns null data when nothing is stored', () => {
	assert.deepEqual(createStorage(memory()).load(), { data: null, corrupt: false });
});

test('save then load round-trips', () => {
	const backend = memory();
	const s = createStorage(backend);
	assert.equal(s.save(layout), true);
	assert.deepEqual(s.load(), { data: layout, corrupt: false });
});

test('unparseable data is backed up and reported as corrupt', () => {
	const backend = memory({ vizanti_v2: "{not json" });
	const r = createStorage(backend).load();
	assert.deepEqual(r, { data: null, corrupt: true });
	assert.equal(backend.data.vizanti_v2_backup, "{not json");
});

test('data of the wrong shape is backed up and reported as corrupt', () => {
	for (const bad of ['null', '[]', '{"version":1,"items":[]}', '{"version":2}', '{"version":2,"items":{}}']) {
		const backend = memory({ vizanti_v2: bad });
		assert.deepEqual(createStorage(backend).load(), { data: null, corrupt: true }, bad);
		assert.equal(backend.data.vizanti_v2_backup, bad);
	}
});

test('save reports failure when the backend throws (storage full or disabled)', () => {
	const backend = memory();
	backend.setItem = () => { throw new Error("QuotaExceededError"); };
	assert.equal(createStorage(backend).save(layout), false);
});

test('load survives a backend that throws on read', () => {
	const backend = memory();
	backend.getItem = () => { throw new Error("SecurityError"); };
	assert.deepEqual(createStorage(backend).load(), { data: null, corrupt: false });
});

test('clear removes the stored layout', () => {
	const backend = memory();
	const s = createStorage(backend);
	s.save(layout);
	s.clear();
	assert.deepEqual(s.load(), { data: null, corrupt: false });
});

test('resolveBackend falls back to memory when the browser refuses access to storage', async () => {
	const { resolveBackend } = await import('../../public/js/core/storage.js');
	const backend = resolveBackend(() => { throw new Error("SecurityError"); });
	const s = createStorage(backend);
	assert.equal(s.save(layout), true);
	assert.deepEqual(s.load(), { data: layout, corrupt: false });
	s.clear();
	assert.deepEqual(s.load(), { data: null, corrupt: false });
	assert.equal(resolveBackend(() => null).getItem("x"), null);
	const real = memory();
	assert.equal(resolveBackend(() => real), real);
});
