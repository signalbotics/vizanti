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
// Returns { positions, colors, count, stride } or { error }.
export function decodeCloud(msg, maxPoints) {
	const field = (name) => msg.fields.find((f) => f.name === name);
	const fx = field("x"), fy = field("y"), fz = field("z");
	if (!fx || !fy || !fz)
		return { error: "XYZ coordinate data not found in cloud." };
	if (!READERS[fx.datatype] || !READERS[fy.datatype] || !READERS[fz.datatype])
		return { error: "XYZ fields use an unknown datatype." };
	const frgb = field("rgb") ?? field("rgba");

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
		count++;
	}

	return {
		positions: positions.slice(0, count * 3),
		colors: colors ? colors.slice(0, count * 3) : null,
		count,
		stride,
	};
}
