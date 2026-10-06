import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProps } from '../../public/js/core/properties.js';
import { BatteryWidget, batteryIcon, batteryReadout } from '../../public/js/displays/battery_widget.js';
import { TemperatureWidget, temperatureBand } from '../../public/js/displays/temperature_widget.js';
import { SpeedometerWidget, SpeedTracker, formatDial } from '../../public/js/displays/speedometer_widget.js';

test('batteryIcon picks the level band and the charging variant', () => {
	assert.equal(batteryIcon(0.1, false), "assets/battery_20.svg");
	assert.equal(batteryIcon(0.2, false), "assets/battery_20.svg");
	assert.equal(batteryIcon(0.55, true), "assets/battery_60_charging.svg");
	assert.equal(batteryIcon(1, false), "assets/battery_100.svg");
	assert.equal(batteryIcon(NaN, false), "assets/battery_unknown.svg");
});

test('batteryReadout formats the message and leaves unknown fields as a dash', () => {
	const r = batteryReadout({
		percentage: 0.734, voltage: 24.2, current: 0, charge: NaN, capacity: 10,
		cell_voltage: [4.1, 4.05], power_supply_status: 2, power_supply_health: 1, power_supply_technology: 3,
	});
	assert.equal(r.percentage, "73 %");
	assert.equal(r.voltage, "24.20 V");
	assert.equal(r.current, "–");
	assert.equal(r.charge, "–");
	assert.equal(r.cells, "4.10 V, 4.05 V");
	assert.deepEqual([r.status, r.health, r.chemistry], ["Discharging", "Good", "LiPo"]);
	assert.equal(batteryReadout(null).percentage, "–");
});

test('temperatureBand compares against the thresholds', () => {
	assert.equal(temperatureBand(70, 20, 60), "hot");
	assert.equal(temperatureBand(10, 20, 60), "cold");
	assert.equal(temperatureBand(40, 20, 60), "warm");
	assert.equal(temperatureBand(undefined, 20, 60), "unknown");
});

test('SpeedTracker averages the speed and tracks min / max', () => {
	const t = new SpeedTracker();
	assert.equal(t.add({ x: 0, y: 0, z: 0 }, 0), false); // first sample: no speed yet
	assert.equal(t.add({ x: 1, y: 0, z: 0 }, 1), true);
	assert.equal(t.average, 1);
	assert.equal(t.add({ x: 1, y: 0, z: 0 }, 1.005), false); // duplicate stamp
	t.add({ x: 4, y: 0, z: 0 }, 2); // 3 m/s, filtered to 2
	assert.equal(t.samples.at(-1), 2);
	assert.equal(t.average, 1.5);
	assert.equal(t.min, 1);
	assert.equal(t.max, 1.5);
	assert.equal(t.needle, 1);
	t.reset();
	assert.equal(t.samples.length, 0);
	assert.equal(t.needle, 0);
});

test('formatDial fits four digits', () => {
	assert.equal(formatDial(1.23456), "1.235");
	assert.equal(formatDial(12.345), "12.35");
	assert.equal(formatDial(1234.5), "1234");
	assert.equal(formatDial(123456), "9999");
});

test('the ported widgets read the old template settings', () => {
	const check = (Cls, legacy, expected) => {
		const { values } = resolveProps(Cls.properties, Cls.migrateProps(legacy));
		for (const [key, value] of Object.entries(expected))
			assert.equal(values[key], value, `${Cls.type}.${key}`);
	};
	check(BatteryWidget, { state: { topic: "/battery" } }, { topic: "/battery", throttle: 500, show_panel: false });
	check(TemperatureWidget, { state: { topic: "/temp", high: "45.5", low: "" } }, { topic: "/temp", high: 45.5, low: 20 });
	check(SpeedometerWidget, { state: { frame: "base_footprint", fixed_frame: "map", units: "km/h" } },
		{ frame: "base_footprint", fixed_frame: "map", units: "km/h" });
	check(SpeedometerWidget, { state: { units: "warp" } }, { frame: "base_link", units: "m/s" });
	// props saved by the native widget pass through unchanged
	check(TemperatureWidget, { topic: "/t", high: 30 }, { topic: "/t", high: 30 });
});
