import { toBytes } from './pointcloud.js';
import { intrinsics, cameraInfoValid } from './camera.js';

const DEPTH = {
	"16UC1": { bytes: 2, scale: 0.001, read: (view, offset, le) => view.getUint16(offset, le) },
	mono16: { bytes: 2, scale: 0.001, read: (view, offset, le) => view.getUint16(offset, le) },
	"32FC1": { bytes: 4, scale: 1, read: (view, offset, le) => view.getFloat32(offset, le) },
};

// Turns a depth image into points in the camera's optical frame (z forward, x right, y down),
// taking every `stride`-th pixel in both directions. Depths of zero, NaN or beyond maxDepth
// metres are skipped. Returns { positions, count } or { error }.
export function depthToPoints(msg, info, { stride, maxDepth }) {
	const format = DEPTH[msg.encoding];
	if (!format)
		return { error: `"${msg.encoding}" is not a depth encoding (16UC1 or 32FC1 expected).` };
	if (!cameraInfoValid(info))
		return { error: "No usable CameraInfo yet." };
	const bytes = toBytes(msg.data);
	if (!bytes)
		return { error: "Depth data arrived in an unknown form." };

	const { width, height } = msg;
	const step = msg.step > 0 ? msg.step : width * format.bytes;
	if (bytes.length < (height - 1) * step + width * format.bytes)
		return { error: `Depth data is ${bytes.length} bytes, smaller than the ${width}x${height} image it declares.` };

	const { fx, fy, cx, cy } = intrinsics(info);
	// intrinsics are for the CameraInfo resolution; scale them if the depth image differs
	const sx = width / info.width, sy = height / info.height;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const le = !msg.is_bigendian;
	const s = Math.max(1, Math.floor(stride));
	const out = new Float32Array(Math.ceil(width / s) * Math.ceil(height / s) * 3);

	let count = 0;
	for (let v = 0; v < height; v += s) {
		for (let u = 0; u < width; u += s) {
			const z = format.read(view, v * step + u * format.bytes, le) * format.scale;
			if (!(z > 0) || z > maxDepth)
				continue;
			out[count * 3] = ((u / sx - cx) / fx) * z;
			out[count * 3 + 1] = ((v / sy - cy) / fy) * z;
			out[count * 3 + 2] = z;
			count++;
		}
	}
	return { positions: out.slice(0, count * 3), count };
}
