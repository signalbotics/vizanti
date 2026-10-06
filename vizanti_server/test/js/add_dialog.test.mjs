import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesQuery } from '../../public/js/ui/add_dialog.js';

test('search matches every typed word anywhere in the entry, ignoring case and order', () => {
	const text = "Laser Scan Renders lidar points sensor_msgs/msg/LaserScan scan Sensors";
	assert.equal(matchesQuery(text, "laser"), true);
	assert.equal(matchesQuery(text, "LIDAR sensors"), true);
	assert.equal(matchesQuery(text, "msg/LaserScan"), true);
	assert.equal(matchesQuery(text, "laser map"), false);
	assert.equal(matchesQuery(text, "   "), true);
});
