import { ImageDisplay } from './image.js';
import { toBytes } from '../geometry/pointcloud.js';

export function formatBytes(bytes) {
	if (bytes >= 1024 * 1024)
		return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
	if (bytes >= 1024)
		return `${(bytes / 1024).toFixed(1)} kB`;
	return `${Math.round(bytes)} B`;
}

// Rate and bandwidth over the last few messages.
export class StreamStats {

	constructor(window = 10) {
		this.window = window;
		this.samples = []; // [time ms, bytes]
	}

	add(time, bytes) {
		this.samples.push([time, bytes]);
		if (this.samples.length > this.window)
			this.samples.shift();
	}

	// messages per second, or NaN until there are two
	get rate() {
		const n = this.samples.length;
		if (n < 2)
			return NaN;
		const span = (this.samples[n - 1][0] - this.samples[0][0]) / 1000;
		return span > 0 ? (n - 1) / span : NaN;
	}

	get meanBytes() {
		return this.samples.length ? this.samples.reduce((sum, [, b]) => sum + b, 0) / this.samples.length : 0;
	}
}

// A JPEG / PNG sensor_msgs/CompressedImage, shown like the Image display, optionally rotated.
export class CompressedImageDisplay extends ImageDisplay {

	static type = "compressedimage";
	static label = "Compressed Image";
	static icon = "assets/image.svg";
	static description = "sensor_msgs/CompressedImage (JPEG / PNG) in a corner of the view or its own panel";
	static msgTypes = ["sensor_msgs/msg/CompressedImage"];

	static properties = {
		...ImageDisplay.properties,
		rotation: {
			type: "enum", label: "Rotation", default: 0,
			options: [0, 90, 180, 270].map((value) => ({ value, label: `${value}°` })),
		},
		throttle: { type: "int", label: "Socket throttle (ms)", default: 500, min: 0, max: 10000,
			help: "Images through rosbridge can congest the link; a lower throttle gives faster updates but other displays may stutter." },
	};

	// the old template widget saved { state: { topic, opacity, throttle, width (% of the window),
	// img_offset_x / img_offset_y (% of the window, the image centre), rotation }, numbers as text
	static migrateProps(props) {
		const s = props.state;
		if (!s)
			return props;
		const out = {};
		if (typeof s.topic === "string")
			out.topic = s.topic;
		const num = (key) => parseFloat(s[key]);
		if (Number.isFinite(num("opacity")))
			out.opacity = num("opacity");
		if (Number.isFinite(num("throttle")))
			out.throttle = Math.round(num("throttle"));
		if (Number.isFinite(num("width")))
			out.size = Math.max(40, Math.round(num("width") / 100 * (globalThis.innerWidth ?? 1920)));
		if ([0, 90, 180, 270].includes(num("rotation")))
			out.rotation = num("rotation");
		const x = num("img_offset_x"), y = num("img_offset_y");
		if (Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0)
			out.corner = `${y < 50 ? "top" : "bottom"}-${x < 50 ? "left" : "right"}`;
		return out;
	}

	onCreate() {
		super.onCreate();
		this.stats = new StreamStats();
	}

	async onMessage(msg) {
		const bytes = toBytes(msg.data);
		if (!bytes) {
			this.status.error("Image data arrived in an unknown form.");
			return;
		}
		this.stats.add(performance.now(), bytes.length);
		if (this.decoding)
			return; // still drawing the previous frame; skip this one
		this.decoding = true;
		try {
			const format = String(msg.format ?? "").toLowerCase();
			const bitmap = await createImageBitmap(new Blob([bytes], { type: format.includes("png") ? "image/png" : "image/jpeg" }));
			if (!this._alive) {
				bitmap.close();
				return;
			}
			const rotation = this.props.rotation;
			const sideways = rotation === 90 || rotation === 270;
			const width = sideways ? bitmap.height : bitmap.width;
			const height = sideways ? bitmap.width : bitmap.height;
			if (this.canvas.width !== width || this.canvas.height !== height) {
				this.canvas.width = width;
				this.canvas.height = height;
			}
			const ctx = this.canvas.getContext("2d");
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.translate(width / 2, height / 2);
			ctx.rotate(rotation * Math.PI / 180);
			ctx.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			this.canvas.style.display = this.enabled ? "block" : "none";
			const rate = this.stats.rate;
			this.setInfo({
				"Frame": msg.header.frame_id,
				"Size": `${bitmap.width} x ${bitmap.height}`,
				"Format": msg.format,
				"Data size": formatBytes(bytes.length),
				"Rate": Number.isFinite(rate) ? `${rate.toFixed(1)} Hz` : "?",
				"Bandwidth": Number.isFinite(rate) ? `${formatBytes(this.stats.meanBytes * rate)}/s` : "?",
			});
			bitmap.close();
			this.status.ok();
		} catch (e) {
			this.status.error(`Could not decode the image (${msg.format}): ${e.message}`);
		} finally {
			this.decoding = false;
		}
	}

	onPropertyChange(key, value) {
		if (key === "topic")
			this.stats = new StreamStats();
		super.onPropertyChange(key, value);
	}
}
