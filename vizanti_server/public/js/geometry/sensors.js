export const SENSOR_TYPES = {
	temperature: "sensor_msgs/msg/Temperature",
	pressure: "sensor_msgs/msg/FluidPressure",
	illuminance: "sensor_msgs/msg/Illuminance",
	humidity: "sensor_msgs/msg/RelativeHumidity",
};

const READERS = {
	[SENSOR_TYPES.temperature]: (m) => [m.temperature, (v) => v.toFixed(2) + " °C"],
	[SENSOR_TYPES.pressure]: (m) => [m.fluid_pressure, (v) => v.toFixed(2) + " Pa"],
	[SENSOR_TYPES.illuminance]: (m) => [m.illuminance, (v) => v.toFixed(2) + " lx"],
	[SENSOR_TYPES.humidity]: (m) => [m.relative_humidity, (v) => (v * 100).toFixed(1) + " %"],
};

// The reading of a scalar sensor message as { value, text }, or null.
export function sensorReading(msg, type) {
	const reader = READERS[type];
	if (!reader)
		return null;
	const [value, format] = reader(msg);
	return typeof value === "number" && Number.isFinite(value) ? { value, text: format(value) } : null;
}
