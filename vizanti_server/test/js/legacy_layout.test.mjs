import test from 'node:test';
import assert from 'node:assert/strict';
import { isLegacyLayout, convertLegacyLayout } from '../../public/js/core/legacy_layout.js';
import { MapDisplay } from '../../public/js/displays/map.js';
import { GridDisplay } from '../../public/js/displays/grid.js';
import { MarkerArrayDisplay } from '../../public/js/displays/markerarray.js';
import { OdomDisplay } from '../../public/js/displays/odom.js';
import { resolveProps } from '../../public/js/core/properties.js';

class Teleop { static kind = "template"; static type = "teleop"; }
const classes = new Map([["map", MapDisplay], ["grid", GridDisplay], ["markerarray", MarkerArrayDisplay], ["odom", OdomDisplay], ["teleop", Teleop]]);

const old = {
	navbar: [
		{ type: "settings", id: "settings_default" },
		{ type: "grid", id: "grid_default" },
		{ type: "map", id: "map_autoID_3" },
		{ type: "folder", id: "folder_autoID_4" },
		{ type: "teleop", id: "teleop_autoID_5", container_id: "folder_autoID_4_widget_container" },
		{ type: "markerarray", id: "markerarray_autoID_6", container_id: "icon_container" },
		{ type: "odom", id: "odom_autoID_7" },
	],
	uid: 8,
	view: { center: { x: 2, y: 3 }, scale: 80 },
	settings_default: { fixed_frame: "map", background_color: "#112233" },
	grid_default: { size: 2, thickness: 3, colour: "#ff0000", colour_sub: "#00ff00", autoscale: "Off", subdivisions: 4, frame: "" },
	map_autoID_3: { topic: "/map", opacity: "0.5", colour_scheme: 1, throttle: "500", use_timestamp: true },
	teleop_autoID_5: { topic: "/cmd_vel", vel_vert: 0.5 },
	markerarray_autoID_6: { topic: "/m", throttle: "100", opacity: "1", disabled_namespaces: ["debug"] },
	odom_autoID_7: { topic: "base_link (Frame)", history: "500", color: "#c43b00", throttle: "500", draw_arrows: true, draw_path: false, save_history: true },
};

test('isLegacyLayout recognises the old settings object only', () => {
	assert.equal(isLegacyLayout(old), true);
	assert.equal(isLegacyLayout({ version: 2, items: [] }), false);
	assert.equal(isLegacyLayout(null), false);
	assert.equal(isLegacyLayout("x"), false);
});

test('global settings and the camera are carried over', () => {
	const v2 = convertLegacyLayout(old, classes);
	assert.equal(v2.version, 2);
	assert.equal(v2.uid, 8);
	assert.deepEqual(v2.global, { fixed_frame: "map", background: "#112233" });
	// the old view stored the centre with y pointing down the screen
	assert.deepEqual(v2.ui.camera, { mode: "topdown", topdown: { x: 2, y: -3, zoom: 80 } });
});

test('widgets keep their ids, order and folder, and the settings widget becomes global options', () => {
	const v2 = convertLegacyLayout(old, classes);
	assert.deepEqual(v2.items.map((i) => i.id), ["grid_default", "map_autoID_3", "folder_autoID_4", "teleop_autoID_5", "markerarray_autoID_6", "odom_autoID_7"]);
	assert.deepEqual(v2.items.map((i) => i.container), ["", "", "", "folder_autoID_4_widget_container", "", ""]);
});

test('native displays get their old options, through fromLegacy where the format changed', () => {
	const v2 = convertLegacyLayout(old, classes);
	const props = (id, Cls) => resolveProps(Cls.properties, v2.items.find((i) => i.id === id).props).values;
	assert.deepEqual(props("grid_default", GridDisplay), { frame: "", autoscale: "Off", size: 2, thickness: 3, colour: "#ff0000", subdivisions: 4, colour_sub: "#00ff00" });
	assert.deepEqual(props("map_autoID_3", MapDisplay), {
		topic: "/map", colour_scheme: "costmap", use_timestamp: true, opacity: 0.5, throttle: 500,
		use_updates: true, update_topic: "",
	});
	assert.deepEqual(props("markerarray_autoID_6", MarkerArrayDisplay).disabled_namespaces, { debug: true });
	const odom = props("odom_autoID_7", OdomDisplay);
	assert.deepEqual([odom.mode, odom.frame, odom.topic, odom.history, odom.draw_path], ["tf", "base_link", "", 500, false]);
});

test('template widgets and unknown types keep their whole state', () => {
	const v2 = convertLegacyLayout(old, classes);
	assert.deepEqual(v2.items.find((i) => i.id === "teleop_autoID_5").props, { topic: "/cmd_vel", state: { topic: "/cmd_vel", vel_vert: 0.5 } });
	assert.deepEqual(v2.items.find((i) => i.id === "folder_autoID_4").props, { topic: "", state: {} });
});

test('very old map settings with costmap_mode still convert', () => {
	assert.equal(MapDisplay.fromLegacy({ costmap_mode: true }).colour_scheme, "costmap");
	assert.equal(MapDisplay.fromLegacy({ colour_scheme: 5 }).colour_scheme, "sonar");
	assert.equal(MapDisplay.fromLegacy({ colour_scheme: 99 }).colour_scheme, "map");
});

test('damaged entries are skipped instead of breaking the conversion', () => {
	const v2 = convertLegacyLayout({ navbar: [null, 5, { type: "grid" }, { id: "x" }, { type: "grid", id: "g" }], view: "nope", g: "not an object" }, classes);
	assert.deepEqual(v2.items.map((i) => i.id), ["g"]);
	assert.equal(v2.ui.camera, undefined);
	assert.equal(v2.uid, 0);
});
