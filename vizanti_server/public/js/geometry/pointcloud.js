// sensor_msgs/PointField datatypes
const READERS = {
	1: (view, offset) => view.getInt8(offset),
	2: (view, offset) => view.getUint8(offset),
	3: (view, offset, le) => view.getInt16(offset, le),
	4: (view, offset, le) => view.getUint16(offset, le),
	5: (view, offset, le) => view.getInt32(offset, le),
	6: (view, offset, le) => view.getUint32(offset, le),
	7: (view, offset, le) => view.getFloat32(offset, le),
	8: (view, offset, le) => view.getFloat64(offset, le),
};

// rosbridge delivers the byte array as base64 text (JSON), a typed array (CBOR) or a plain array
export function toBytes(data) {
	if (typeof data === "string") {
		const binary = atob(data);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++)
			bytes[i] = binary.charCodeAt(i);
		return bytes;
	}
	if (data instanceof Uint8Array)
		return data;
	if (data instanceof ArrayBuffer)
		return new Uint8Array(data);
	if (ArrayBuffer.isView(data))
		return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
	if (Array.isArray(data))
		return Uint8Array.from(data);
	return null;
}

// Decodes a sensor_msgs/PointCloud2 into xyz positions and, when the cloud has an rgb field,
// 0..1 colours. Clouds with more than maxPoints points are thinned evenly.
// options.channel names a scalar field (e.g. "intensity") to read per point as `values`.
// Returns { positions, colors, values, range, count, stride } or { error }.
export function decodeCloud(msg, maxPoints, { channel = "" } = {}) {
	const field = (name) => msg.fields.find((f) => f.name === name);
	const fx = field("x"), fy = field("y"), fz = field("z");
	if (!fx || !fy || !fz)
		return { error: "XYZ coordinate data not found in cloud." };
	if (!READERS[fx.datatype] || !READERS[fy.datatype] || !READERS[fz.datatype])
		return { error: "XYZ fields use an unknown datatype." };
	const frgb = field("rgb") ?? field("rgba");
	const fchannel = channel ? field(channel) : null;
	const rchannel = fchannel ? READERS[fchannel.datatype] : null;

	const bytes = toBytes(msg.data);
	if (!bytes)
		return { error: "Cloud in unknown data type: " + typeof msg.data };

	const total = msg.width * msg.height;
	const step = msg.point_step;
	if (bytes.length < total * step)
		return { error: `Cloud data is ${bytes.length} bytes, smaller than the ${total} points of ${step} bytes it declares.` };

	const stride = total > maxPoints ? Math.ceil(total / maxPoints) : 1;
	const capacity = Math.ceil(total / stride);
	const positions = new Float32Array(capacity * 3);
	const colors = frgb ? new Float32Array(capacity * 3) : null;
	const values = rchannel ? new Float32Array(capacity) : null;
	let min = Infinity, max = -Infinity;

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const le = !msg.is_bigendian;
	const rx = READERS[fx.datatype], ry = READERS[fy.datatype], rz = READERS[fz.datatype];

	let count = 0;
	for (let i = 0; i < total; i += stride) {
		const base = i * step;
		const x = rx(view, base + fx.offset, le);
		const y = ry(view, base + fy.offset, le);
		const z = rz(view, base + fz.offset, le);
		if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
			continue; // dense clouds mark invalid points with NaN

		positions[count * 3] = x;
		positions[count * 3 + 1] = y;
		positions[count * 3 + 2] = z;
		if (colors) {
			const bits = view.getUint32(base + frgb.offset, le);
			colors[count * 3] = ((bits >> 16) & 0xff) / 255;
			colors[count * 3 + 1] = ((bits >> 8) & 0xff) / 255;
			colors[count * 3 + 2] = (bits & 0xff) / 255;
		}
		if (values) {
			const v = rchannel(view, base + fchannel.offset, le);
			values[count] = v;
			if (Number.isFinite(v)) {
				if (v < min) min = v;
				if (v > max) max = v;
			}
		}
		count++;
	}

	return {
		positions: positions.slice(0, count * 3),
		colors: colors ? colors.slice(0, count * 3) : null,
		values: values ? values.slice(0, count) : null,
		range: values && min <= max ? { min, max } : null,
		count,
		stride,
	};
}

// Blue (0) through cyan, green and yellow to red (1), as RGB in 0..1.
export function rainbow(t) {
	const v = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
	// hue 240 degrees (blue) down to 0 (red), full saturation and value
	const h = (1 - v) * 4; // 0..4 across the four sextants red..blue
	const i = Math.floor(h);
	const f = h - i;
	switch (i) {
		case 0: return [1, f, 0];          // red -> yellow
		case 1: return [1 - f, 1, 0];      // yellow -> green
		case 2: return [0, 1, f];          // green -> cyan
		case 3: return [0, 1 - f, 1];      // cyan -> blue
		default: return [0, 0, 1];
	}
}

// The rainbow in 1024 steps: a table lookup per point instead of a call (and an array) per
// point; at 200,000 points this is the difference between ~40 ms and a few ms.
const LUT_SIZE = 1024;
let lut = null;
function rainbowTable() {
	if (!lut) {
		lut = new Float32Array(LUT_SIZE * 3);
		for (let i = 0; i < LUT_SIZE; i++)
			lut.set(rainbow(i / (LUT_SIZE - 1)), i * 3);
	}
	return lut;
}

// One rainbow colour per value, spread over [min, max]; a flat range gets the middle colour.
export function colorizeValues(values, min, max) {
	const out = new Float32Array(values.length * 3);
	const span = max - min;
	if (!(span > 0)) {
		const [r, g, b] = rainbow(0.5);
		for (let i = 0; i < values.length; i++) {
			out[i * 3] = r;
			out[i * 3 + 1] = g;
			out[i * 3 + 2] = b;
		}
		return out;
	}
	const table = rainbowTable();
	const scale = (LUT_SIZE - 1) / span;
	for (let i = 0; i < values.length; i++) {
		let k = Math.round((values[i] - min) * scale);
		k = k > 0 ? (k < LUT_SIZE ? k : LUT_SIZE - 1) : 0; // also catches NaN
		out[i * 3] = table[k * 3];
		out[i * 3 + 1] = table[k * 3 + 1];
		out[i * 3 + 2] = table[k * 3 + 2];
	}
	return out;
}

// Each point's coordinate along "x", "y" or "z" after a column-major 4x4 transform (e.g. the
// cloud frame to the fixed frame), for colouring by height.
export function axisValues(positions, matrix, axis) {
	const row = { x: 0, y: 1, z: 2 }[axis] ?? 2;
	const a = matrix[row], b = matrix[4 + row], c = matrix[8 + row], d = matrix[12 + row];
	const out = new Float32Array(positions.length / 3);
	for (let i = 0; i < out.length; i++)
		out[i] = a * positions[i * 3] + b * positions[i * 3 + 1] + c * positions[i * 3 + 2] + d;
	return out;
}
