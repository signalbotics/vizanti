import { toBytes } from './pointcloud.js';

const COLOUR = {
	rgb8: { channels: 3, order: [0, 1, 2, -1] },
	bgr8: { channels: 3, order: [2, 1, 0, -1] },
	rgba8: { channels: 4, order: [0, 1, 2, 3] },
	bgra8: { channels: 4, order: [2, 1, 0, 3] },
	mono8: { channels: 1, order: [0, 0, 0, -1] },
	"8UC1": { channels: 1, order: [0, 0, 0, -1] },
	"8UC3": { channels: 3, order: [2, 1, 0, -1] },
};

// single-channel encodings wider than a byte; shown as grey, stretched between min and max
const SCALAR = {
	mono16: { bytes: 2, read: (view, offset, le) => view.getUint16(offset, le) },
	"16UC1": { bytes: 2, read: (view, offset, le) => view.getUint16(offset, le) },
	"16SC1": { bytes: 2, read: (view, offset, le) => view.getInt16(offset, le) },
	"32FC1": { bytes: 4, read: (view, offset, le) => view.getFloat32(offset, le) },
};

// Converts a sensor_msgs/Image to RGBA pixels. Returns { rgba, width, height } or { error }.
export function imageToRGBA(msg) {
	const { width, height, encoding } = msg;
	if (!(width > 0) || !(height > 0))
		return { error: "The image is empty." };

	const colour = COLOUR[encoding];
	const scalar = SCALAR[encoding];
	if (!colour && !scalar)
		return { error: `Image encoding "${encoding}" is not supported.` };

	const bytes = toBytes(msg.data);
	if (!bytes)
		return { error: "Image data arrived in an unknown form." };
	const pixelBytes = colour ? colour.channels : scalar.bytes;
	const step = msg.step > 0 ? msg.step : width * pixelBytes;
	if (bytes.length < (height - 1) * step + width * pixelBytes)
		return { error: `Image data is ${bytes.length} bytes, smaller than the ${width}x${height} image it declares.` };

	const rgba = new Uint8ClampedArray(width * height * 4);

	if (colour) {
		const [r, g, b, a] = colour.order;
		for (let y = 0; y < height; y++) {
			for (let x = 0; x < width; x++) {
				const src = y * step + x * pixelBytes;
				const dst = (y * width + x) * 4;
				rgba[dst] = bytes[src + r];
				rgba[dst + 1] = bytes[src + g];
				rgba[dst + 2] = bytes[src + b];
				rgba[dst + 3] = a === -1 ? 255 : bytes[src + a];
			}
		}
		return { rgba, width, height };
	}

	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const le = !msg.is_bigendian;
	const values = new Float64Array(width * height);
	let min = Infinity, max = -Infinity;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const value = scalar.read(view, y * step + x * pixelBytes, le);
			values[y * width + x] = value;
			if (Number.isFinite(value)) {
				if (value < min) min = value;
				if (value > max) max = value;
			}
		}
	}
	const range = max > min ? max - min : 1;
	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		if (!Number.isFinite(value))
			continue; // invalid depth stays transparent
		const grey = ((value - min) / range) * 255;
		rgba[i * 4] = grey;
		rgba[i * 4 + 1] = grey;
		rgba[i * 4 + 2] = grey;
		rgba[i * 4 + 3] = 255;
	}
	return { rgba, width, height, min, max };
}
