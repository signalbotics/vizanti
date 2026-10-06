import test from 'node:test';
import assert from 'node:assert/strict';
import { dropIndex } from '../../public/js/ui/reorder.js';

// items [A, B, C, D]; dropIndex(from, over, after) is the index passed to registry.move
test('dropping above or below another row gives the index the row ends up at', () => {
	assert.equal(dropIndex(0, 2, false), 1, "A dropped above C -> [B, A, C, D]");
	assert.equal(dropIndex(0, 2, true), 2, "A dropped below C -> [B, C, A, D]");
	assert.equal(dropIndex(3, 0, false), 0, "D dropped above A -> [D, A, B, C]");
	assert.equal(dropIndex(3, 0, true), 1, "D dropped below A -> [A, D, B, C]");
	assert.equal(dropIndex(1, 3, true), 3, "B dropped below D -> [A, C, D, B]");
});

test('dropping a row onto itself or right next to where it is changes nothing', () => {
	assert.equal(dropIndex(1, 1, false), 1);
	assert.equal(dropIndex(1, 1, true), 1);
	assert.equal(dropIndex(1, 2, false), 1, "B dropped above C stays put");
	assert.equal(dropIndex(1, 0, true), 1, "B dropped below A stays put");
});
