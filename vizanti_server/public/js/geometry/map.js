export const COLOUR_SCHEMES = ["map", "costmap", "raw", "raw_transparent", "raw_transparent_black", "sonar"];

function table() {
	return { r: new Uint8Array(256), g: new Uint8Array(256), b: new Uint8Array(256), a: new Uint8Array(256) };
}

function set(lut, i, r, g, b, a) {
	lut.r[i] = r;
	lut.g[i] = g;
	lut.b[i] = b;
	lut.a[i] = a;
}

const stretch = (x, lo, hi) => Math.min(255, Math.max(0, (x - lo) * (255 / (hi - lo))));

// Lookup tables indexed by the cell value as an unsigned byte (-1 is 255).
// Values are copied from the original templates/map/map_worker.js.
const LUTS = {};
for (const scheme of COLOUR_SCHEMES)
	LUTS[scheme] = table();

const ALPHA = new Uint8Array(256);
for (let i = 0; i < 256; i++)
	ALPHA[i] = Math.round(255 * Math.pow(i / 255, 0.5));

for (let i = 0; i < 256; i++) {
	// map: 0 (free) white to 100 (occupied) black; everything else, -1 included, faint green
	if (i <= 100) {
		const v = 255 - (255 * i) / 100;
		set(LUTS.map, i, v, v, v, 255);
	} else {
		set(LUTS.map, i, 0, 255, 0, 30);
	}

	// costmap
	if (i === 0) {
		set(LUTS.costmap, i, 0, 0, 0, 0);
	} else if (i <= 98) {
		const v = (255 * i) / 100;
		set(LUTS.costmap, i, v, 0, 255 - v, 255);
	} else if (i === 99) {
		set(LUTS.costmap, i, 0, 255, 255, 255);
	} else if (i === 100) {
		set(LUTS.costmap, i, 255, 0, 255, 255);
	} else if (i === 255) {
		set(LUTS.costmap, i, 0x70, 0x89, 0x86, 15);
	} else {
		set(LUTS.costmap, i, 0, 255, 0, 0);
	}

	set(LUTS.raw, i, i, i, i, 255);
	set(LUTS.raw_transparent, i, i, i, i, ALPHA[255 - i]);
	set(LUTS.raw_transparent_black, i, i, i, i, ALPHA[i]);

	set(LUTS.sonar, i, stretch(i, 0, 128), stretch(i, 64, 192), stretch(i, 128, 255), i >= 10 ? 255 : Math.round(i * 255 / 10));
}

// Converts OccupancyGrid data (row-major, -1..100 or raw bytes) into an RGBA image.
// Maps wider or taller than maxSize are reduced by taking every factor-th cell.
export function mapToRGBA(data, width, height, scheme, maxSize = Infinity) {
	if (data.length !== width * height)
		return { error: `Map data has ${data.length} cells, expected ${width}x${height}.` };

	const factor = Math.max(1, Math.ceil(Math.max(width, height) / maxSize));
	const w = Math.ceil(width / factor);
	const h = Math.ceil(height / factor);
	const rgba = new Uint8Array(w * h * 4);
	const lut = LUTS[scheme] ?? LUTS.raw;

	for (let y = 0; y < h; y++) {
		const row = y * factor * width;
		for (let x = 0; x < w; x++) {
			let v = data[row + x * factor] | 0;
			if (v < 0)
				v += 256;
			if (v < 0)
				v = 0;
			else if (v > 255)
				v = 255;

			const o = (y * w + x) * 4;
			rgba[o] = lut.r[v];
			rgba[o + 1] = lut.g[v];
			rgba[o + 2] = lut.b[v];
			rgba[o + 3] = lut.a[v];
		}
	}

	return { rgba, width: w, height: h, factor };
}
