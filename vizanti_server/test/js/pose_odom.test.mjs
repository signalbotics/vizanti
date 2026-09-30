import test from 'node:test';
import assert from 'node:assert/strict';
import { covarianceEllipse, ellipseTriangles, longArrow, eulerFromQuat, yawSpread } from '../../public/js/geometry/pose.js';
import { appendSample, arrowMarks, samplesToCsv, parseLegacyTarget } from '../../public/js/geometry/track.js';
import { PoseDisplay } from '../../public/js/displays/pose.js';
import { OdomDisplay } from '../../public/js/displays/odom.js';
import { RobotModelDisplay } from '../../public/js/displays/robotmodel.js';
import { defaultsOf } from '../../public/js/core/properties.js';

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const cov = (xx, xy, yy, yaw = 0) => { const c = new Array(36).fill(0); c[0] = xx; c[1] = xy; c[6] = xy; c[7] = yy; c[35] = yaw; return c; };

test('covarianceEllipse gives one-sigma radii along the principal axes', () => {
	const e = covarianceEllipse(cov(4, 0, 1));
	assert.ok(near(e.rx, 2) && near(e.ry, 1) && near(e.theta, 0));
	const tilted = covarianceEllipse(cov(1, 0.5, 1));
	assert.ok(near(tilted.theta, Math.PI / 4));
	assert.ok(near(tilted.rx, Math.sqrt(1.5)) && near(tilted.ry, Math.sqrt(0.5)));
});

test('covarianceEllipse rejects missing, short, negative or non-finite covariance', () => {
	assert.equal(covarianceEllipse(undefined), null);
	assert.equal(covarianceEllipse([1, 2, 3]), null);
	assert.equal(covarianceEllipse(cov(-1, 0, 1)), null);
	assert.equal(covarianceEllipse(cov(NaN, 0, 1)), null);
	assert.equal(covarianceEllipse(cov(0, 0, 0)), null);
});

test('ellipseTriangles is a fan of the requested radii', () => {
	const t = ellipseTriangles(2, 1, 0, 8);
	assert.equal(t.length, 8 * 9);
	let maxX = 0, maxY = 0;
	for (let i = 0; i < t.length; i += 3) { maxX = Math.max(maxX, Math.abs(t[i])); maxY = Math.max(maxY, Math.abs(t[i + 1])); }
	assert.ok(near(maxX, 2) && near(maxY, 1));
});

test('longArrow is two units long per unit of scale', () => {
	const a = longArrow(1.5);
	let maxX = 0;
	for (let i = 0; i < a.length; i += 3) maxX = Math.max(maxX, a[i]);
	assert.ok(near(maxX, 3));
	assert.equal(a.length, 27);
});

test('eulerFromQuat returns roll, pitch and yaw in radians', () => {
	const S = Math.SQRT1_2;
	const yaw = eulerFromQuat({ x: 0, y: 0, z: S, w: S });
	assert.ok(near(yaw.yaw, Math.PI / 2) && near(yaw.roll, 0) && near(yaw.pitch, 0));
	const roll = eulerFromQuat({ x: S, y: 0, z: 0, w: S });
	assert.ok(near(roll.roll, Math.PI / 2));
});

test('yawSpread is two sigma, capped at a full circle', () => {
	assert.ok(near(yawSpread(cov(0, 0, 0, 0.25)), 1));
	assert.equal(yawSpread(cov(0, 0, 0, 100)), 2 * Math.PI);
	assert.equal(yawSpread(undefined), 0);
	assert.equal(yawSpread(cov(0, 0, 0, -1)), 0);
});

test('appendSample ignores jitter under 3 cm and trims to the history length', () => {
	const samples = [];
	assert.equal(appendSample(samples, { x: 0, y: 0, z: 0, yaw: 0 }, 3), true);
	assert.equal(appendSample(samples, { x: 0.01, y: 0, z: 0, yaw: 0 }, 3), false);
	for (let i = 1; i <= 4; i++) appendSample(samples, { x: i, y: 0, z: 0, yaw: 0 }, 3);
	assert.deepEqual(samples.map((s) => s.x), [2, 3, 4]);
	assert.equal(appendSample(samples, { x: NaN, y: 0, z: 0, yaw: 0 }, 3), false);
});

test('arrowMarks spaces heading arrows along the track', () => {
	const samples = Array.from({ length: 11 }, (_, i) => ({ x: i * 0.1, y: 0, z: 0, yaw: 0 }));
	// 0.5 m apart: samples 0, 5 and 10
	assert.equal(arrowMarks(samples, 0.5, 0.2, 0.05).length, 3 * 9);
	assert.equal(arrowMarks([], 0.5, 0.2, 0.05).length, 0);
});

test('samplesToCsv matches the old export format', () => {
	assert.equal(samplesToCsv([{ x: 1, y: 2, z: 3, yaw: 0.5 }]), "x,y,yaw\n1,2,0.5\n");
});

test('parseLegacyTarget splits the old combined target string', () => {
	assert.deepEqual(parseLegacyTarget("base_link (Frame)"), { mode: "tf", frame: "base_link", topic: "" });
	assert.deepEqual(parseLegacyTarget("/odom (Odometry)"), { mode: "topic", frame: "", topic: "/odom" });
	assert.deepEqual(parseLegacyTarget(""), { mode: "tf", frame: "", topic: "" });
});

test('the three displays keep the options and defaults of the widgets they replace', () => {
	assert.deepEqual(defaultsOf(PoseDisplay.properties), {
		topic: "", topic_type: "", rendermode: "long_arrow", throttle: 100, decay: 10000, color: "#f74127", scale: 1,
	});
	assert.equal(PoseDisplay.type, "posewithcovariancestamped");
	assert.deepEqual(PoseDisplay.msgTypes, ["geometry_msgs/msg/PoseWithCovarianceStamped", "geometry_msgs/msg/PoseStamped"]);
	assert.deepEqual(defaultsOf(OdomDisplay.properties), {
		mode: "tf", frame: "", topic: "", color: "#c43b00", history: 2000, throttle: 500, draw_path: true, draw_arrows: true, save_history: true,
	});
	assert.deepEqual(OdomDisplay.fromLegacy({ topic: "/odom (Odometry)", history: "500" }), { topic: "/odom", history: "500", mode: "topic", frame: "" });
	assert.deepEqual(defaultsOf(RobotModelDisplay.properties), {
		frame: "", length: 0.5, offset_x: 0, offset_y: 0, offset_yaw: 0, opacity: 1, sprite: "4wd",
	});
});
