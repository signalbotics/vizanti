import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveProps } from '../../public/js/core/properties.js';
import { altimeterMeters, altimeterTarget, altimeterPublishValue, altimeterTargetAt, AltimeterWidget } from '../../public/js/displays/altimeter_widget.js';

// the navball code uses the page's global Quaternion library
new Function(readFileSync(new URL('../../public/js/lib/quaternion.min.js', import.meta.url), "utf8")).call(globalThis);
const { navballLut, navballAngles, renderNavball, headingFromYaw, quaternionValid, ImuFusion } = await import('../../public/js/geometry/navball.js');
const { NavballWidget } = await import('../../public/js/displays/navball_widget.js');

test('altimeter readings and targets follow the mode', () => {
	assert.equal(altimeterMeters(2.5, "altitude_positive"), 2.5);
	assert.equal(altimeterMeters(-1, "altitude_positive"), 0);
	assert.equal(altimeterMeters(-3.2, "depth_negative"), 3.2);
	assert.equal(altimeterTarget(4, "altitude_positive"), 4);
	assert.ok(Number.isNaN(altimeterTarget(-4, "altitude_positive")));
	assert.equal(altimeterTarget(-4, "depth_negative"), 4);
	assert.ok(Number.isNaN(altimeterTarget(4, "depth_negative")));
	assert.equal(altimeterPublishValue(4, "depth_negative"), -4);
	assert.equal(altimeterPublishValue(4, "depth_positive"), 4);
});

test('a click on the tape maps to a target', () => {
	// the centre is the current reading
	assert.equal(altimeterTargetAt(300, 600, 5, 1, "altitude_positive"), 5);
	// 100 px up is one step higher on an altitude tape, one step shallower on a depth tape
	assert.equal(altimeterTargetAt(200, 600, 5, 1, "altitude_positive"), 6);
	assert.equal(altimeterTargetAt(200, 600, 5, 1, "depth_negative"), 4);
	assert.equal(altimeterTargetAt(200, 600, 5, 2, "altitude_positive"), 7);
});

test('navball helpers', () => {
	const lut = navballLut(20);
	assert.ok(lut.count > 200 && lut.count < 400);
	for (let i = 0; i < lut.count; i++)
		assert.ok(Math.abs(Math.hypot(lut.px[i], lut.py[i], lut.pz[i]) - 1) < 1e-5);
	const tex = { width: 4, height: 2, data: new Uint8ClampedArray(4 * 2 * 4).fill(200) };
	const data = new Uint8ClampedArray(20 * 20 * 4);
	renderNavball(lut, data, tex, navballAngles({ roll: 0.1, pitch: 0.2, yaw: 0.3 }, "horizon_fake", false));
	assert.equal(data[lut.index[0]], 200);
	assert.equal(data[lut.index[0] + 3], 255);
	assert.equal(data[0 + 3], 0); // the corner is outside the ball
	assert.equal(navballAngles({ roll: 0, pitch: 0, yaw: 0 }, "horizon_true", false).inverted, true);
	assert.equal(navballAngles({ roll: 1, pitch: 0, yaw: 0 }, "external", true).roll, Math.PI);
	assert.equal(headingFromYaw(0), 90);
	assert.equal(headingFromYaw(Math.PI / 2), 0);
	assert.equal(quaternionValid({ x: 0, y: 0, z: 0, w: 1 }), true);
	assert.equal(quaternionValid({ x: 0, y: 0, z: 0, w: 0 }), false);
});

test('ImuFusion levels roll from gravity when there is no quaternion', () => {
	const fusion = new ImuFusion();
	const msg = {
		header: { stamp: { sec: 1, nanosec: 0 } },
		angular_velocity: { x: 0, y: 0, z: 0 },
		linear_acceleration: { x: 0, y: 9.81 * Math.sin(0.3), z: 9.81 * Math.cos(0.3) },
	};
	const { quat, note } = fusion.update(msg, new Quaternion());
	assert.match(note, /accel only/);
	assert.ok(quat.toEuler().g > 0); // moving towards the 0.3 rad roll
});

test('altimeter and navball read the old template settings', () => {
	const values = (Cls, legacy) => resolveProps(Cls.properties, Cls.migrateProps(legacy)).values;
	const alt = values(AltimeterWidget, { state: { mode: "depth_negative", frame: "auv", topic: "/depth_tgt", step: "0.5", img_offset_x: 110 } });
	assert.deepEqual([alt.mode, alt.frame, alt.topic, alt.step, alt.side, alt.column], ["depth_negative", "auv", "/depth_tgt", 0.5, "left", 1]);
	const nav = values(NavballWidget, { state: { topic: "/imu/data (Imu)", opacity: "0.6", throttle: "50", width: "20", offset_x: 30, offset_y: 70, angle_mode: "external", alt_roll: true } });
	assert.deepEqual([nav.source, nav.topic, nav.opacity, nav.throttle, nav.width, nav.pos_x, nav.pos_y, nav.mode, nav.alt_roll],
		["imu", "/imu/data", 0.6, 50, 20, 30, 70, "external", true]);
	const tf = values(NavballWidget, { state: { topic: "base_link (Frame)" } });
	assert.deepEqual([tf.source, tf.frame], ["tf", "base_link"]);
});
