// A ROS message (as rosbridge delivers it, JSON or CBOR) as the numeric fields a plot can show,
// named like PlotJuggler names them. Pure, so it runs under node --test.
//
//   numbers                          position/x                 -> as they are
//   booleans                         ok                         -> 0 / 1
//   time / duration {sec, nanosec}   header/stamp               -> seconds
//   quaternion {x, y, z, w}          orientation/x ... /w       -> plus orientation/roll, /pitch, /yaw (rad)
//   arrays                           ranges[3]                  -> one field per element
//   name arrays (JointState)         position[i], name[i]       -> <name>/position
//   arrays of named elements         status[i].name             -> status[<name>]/...
//   key / value pairs (diagnostics)  values[i] {key, value}     -> values/<key> when the value is a number
//
// Strings, and arrays longer than maxArray (images, point cloud data), are left out; the second
// are reported in `skipped`, so the series browser can say why a field is missing.

export const DEFAULT_MAX_ARRAY = 500;

const isNumber = (v) => typeof v === "number";

function isTime(value) {
	if (value === null || typeof value !== "object" || Array.isArray(value))
		return false;
	const keys = Object.keys(value);
	return keys.length === 2 && ((isNumber(value.sec) && isNumber(value.nanosec)) || (isNumber(value.secs) && isNumber(value.nsecs)));
}

function timeSeconds(value) {
	return "sec" in value ? value.sec + value.nanosec * 1e-9 : value.secs + value.nsecs * 1e-9;
}

function isQuaternion(value) {
	const keys = Object.keys(value);
	return keys.length === 4 && isNumber(value.x) && isNumber(value.y) && isNumber(value.z) && isNumber(value.w);
}

// roll, pitch, yaw (radians, ZYX as tf2 gives them) of a quaternion
export function quaternionToRpy({ x, y, z, w }) {
	const n = Math.hypot(x, y, z, w) || 1;
	x /= n; y /= n; z /= n; w /= n;
	const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
	const sinp = 2 * (w * y - z * x);
	const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
	const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
	return { roll, pitch, yaw };
}

// typed arrays (CBOR) and plain arrays
const isArrayLike = (v) => Array.isArray(v) || ArrayBuffer.isView(v);

// the element names an array of objects can be keyed by: every element has a distinct, non-empty
// string `name`; null otherwise
function elementNames(array) {
	if (!Array.isArray(array) || array.length === 0)
		return null;
	const names = [];
	const seen = new Set();
	for (const element of array) {
		const name = element && typeof element === "object" ? element.name : undefined;
		if (typeof name !== "string" || name === "" || seen.has(name))
			return null;
		seen.add(name);
		names.push(name);
	}
	return names;
}

const isKeyValue = (element) => element && typeof element === "object" && !Array.isArray(element)
	&& typeof element.key === "string" && typeof element.value === "string" && Object.keys(element).length === 2;

function join(prefix, key) {
	return prefix === "" ? String(key) : `${prefix}/${key}`;
}

// msg -> { values: [[field, number], ...], skipped: [[field, reason], ...] }
// Fields have no leading slash: the series of field "pose/position/x" on topic "/odom" is
// shown as "/odom/pose/position/x".
export function flattenMessage(msg, { maxArray = DEFAULT_MAX_ARRAY } = {}) {
	const values = [];
	const skipped = [];
	const visit = (value, path) => {
		if (isNumber(value)) {
			if (path !== "")
				values.push([path, value]);
			return;
		}
		if (typeof value === "boolean") {
			values.push([path, value ? 1 : 0]);
			return;
		}
		if (value === null || value === undefined || typeof value === "string")
			return;
		if (isArrayLike(value)) {
			visitArray(value, path);
			return;
		}
		if (typeof value !== "object")
			return;
		if (isTime(value)) {
			values.push([path, timeSeconds(value)]);
			return;
		}
		const quaternion = isQuaternion(value);
		visitObject(value, path);
		if (quaternion) {
			const rpy = quaternionToRpy(value);
			values.push([join(path, "roll"), rpy.roll], [join(path, "pitch"), rpy.pitch], [join(path, "yaw"), rpy.yaw]);
		}
	};
	const visitArray = (array, path) => {
		if (array.length > maxArray) {
			skipped.push([path, `array of ${array.length} elements (more than ${maxArray})`]);
			return;
		}
		if (array.length > 0 && Array.prototype.every.call(array, isKeyValue)) {
			for (const { key, value } of array) {
				const number = Number(value);
				if (value.trim() !== "" && Number.isFinite(number))
					values.push([join(path, key), number]);
			}
			return;
		}
		const names = elementNames(array);
		for (let i = 0; i < array.length; i++)
			visit(array[i], `${path}[${names ? names[i] : i}]`);
	};
	const visitObject = (object, path) => {
		// JointState-like: a `name` list, and arrays of the same length that go with it
		const names = Array.isArray(object.name) && object.name.length > 0 && object.name.every((n) => typeof n === "string") ? object.name : null;
		for (const key of Object.keys(object)) {
			const value = object[key];
			if (names && key !== "name" && isArrayLike(value) && value.length === names.length && value.length <= maxArray
				&& Array.prototype.every.call(value, (v) => isNumber(v) || typeof v === "boolean")) {
				for (let i = 0; i < names.length; i++)
					values.push([join(join(path, names[i]), key), Number(value[i])]);
				continue;
			}
			visit(value, join(path, key));
		}
	};
	visit(msg, "");
	return { values, skipped };
}

// the header stamp of a message in seconds, or null when it has none (or it is zero)
export function stampSeconds(msg) {
	const stamp = msg?.header?.stamp;
	if (!stamp || !isTime(stamp))
		return null;
	const t = timeSeconds(stamp);
	return t > 0 ? t : null;
}
