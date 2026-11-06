// The Costmap Zones panel without the page: keepout and speed zones for Nav2's costmap filters.
// A filter is described by a nav2_msgs/CostmapFilterInfo (its type, the topic of its mask, and
// base and multiplier); its mask is an OccupancyGrid the size of the map. Zones are polygons in
// the mask's frame, filled into the mask with the value the filter reads as the wanted effect.
// Pure.

// nav2_costmap_2d filter_values.hpp
export const FILTERS = {
	0: { key: "keepout", label: "Keepout", unit: null },
	1: { key: "speed_percent", label: "Speed limit", unit: "%" },
	2: { key: "speed_absolute", label: "Speed limit", unit: "m/s" },
	3: { key: "binary", label: "Binary", unit: null },
};

export function filterKind(info) {
	return FILTERS[info?.type] ?? { key: "unknown", label: `Filter type ${info?.type}`, unit: null };
}

// The mask value (1..100) for a zone. Keepout and binary zones are 100 (a keepout cell is
// lethal; the binary filter is on). A speed zone of `limit` is (limit - base) / multiplier, as the
// speed filter reads limit = base + multiplier * value (0 is "no limit", so a zone is 1..100).
// -> { value } or { error }
export function maskValue(info, limit) {
	const kind = filterKind(info);
	if (kind.key === "keepout" || kind.key === "binary")
		return { value: 100 };
	if (kind.key === "unknown")
		return { error: `Unknown filter type ${info?.type}.` };
	const l = Number(limit);
	if (String(limit ?? "").trim() === "" || !Number.isFinite(l) || l < 0)
		return { error: `Give the speed limit in ${kind.unit}.` };
	const base = Number(info.base ?? 0);
	const multiplier = Number(info.multiplier ?? 1);
	if (multiplier === 0)
		return { error: "The filter's multiplier is 0: no mask value gives a limit." };
	const value = Math.round((l - base) / multiplier);
	if (value < 1 || value > 100) {
		const lo = base + multiplier * 1;
		const hi = base + multiplier * 100;
		return { error: `This filter can limit to ${Math.min(lo, hi)} … ${Math.max(lo, hi)} ${kind.unit} (base ${base}, multiplier ${multiplier}).` };
	}
	return { value };
}

// what a mask value means, for the zone list: "keepout", "40 %", "0.25 m/s"
export function valueText(info, value) {
	const kind = filterKind(info);
	if (kind.key === "keepout")
		return "keepout";
	if (kind.key === "binary")
		return "on";
	const limit = Number(info.base ?? 0) + Number(info.multiplier ?? 1) * value;
	return `${Number(limit.toFixed(3))} ${kind.unit}`;
}

// grid: { width, height, resolution, origin: {x, y}, data } (an OccupancyGrid's info, flattened)
export function gridFrom(msg) {
	const info = msg.info;
	const q = info.origin.orientation ?? { x: 0, y: 0, z: 0, w: 1 };
	return {
		width: info.width, height: info.height, resolution: info.resolution,
		origin: { x: info.origin.position.x, y: info.origin.position.y },
		yaw: 2 * Math.atan2(q.z ?? 0, q.w ?? 1),
		frame: msg.header?.frame_id || "map",
		data: Int8Array.from(msg.data ?? []),
	};
}

// even-odd point in polygon
function inside(points, x, y) {
	let hit = false;
	for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
		const a = points[i];
		const b = points[j];
		if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x)
			hit = !hit;
	}
	return hit;
}

// The mask: `base` (the current mask's cells, or all free) with each zone's cells set to its
// value; later zones win. zones: [{ points: [{x, y}], value }]. A cell is in a zone when its
// centre is. Unrotated grids only (map_server's masks are).
export function rasterize(grid, zones, keep = true) {
	const data = keep && grid.data.length === grid.width * grid.height ? Int8Array.from(grid.data) : new Int8Array(grid.width * grid.height);
	for (const zone of zones) {
		if (!zone.points || zone.points.length < 3)
			continue;
		const xs = zone.points.map((p) => (p.x - grid.origin.x) / grid.resolution);
		const ys = zone.points.map((p) => (p.y - grid.origin.y) / grid.resolution);
		const c0 = Math.max(0, Math.floor(Math.min(...xs)));
		const c1 = Math.min(grid.width - 1, Math.ceil(Math.max(...xs)));
		const r0 = Math.max(0, Math.floor(Math.min(...ys)));
		const r1 = Math.min(grid.height - 1, Math.ceil(Math.max(...ys)));
		for (let r = r0; r <= r1; r++) {
			const y = grid.origin.y + (r + 0.5) * grid.resolution;
			for (let c = c0; c <= c1; c++) {
				const x = grid.origin.x + (c + 0.5) * grid.resolution;
				if (inside(zone.points, x, y))
					data[r * grid.width + c] = zone.value;
			}
		}
	}
	return data;
}

// the OccupancyGrid to publish on the filter's mask topic
export function maskMessage(grid, data, stamp = { sec: 0, nanosec: 0 }) {
	const half = grid.yaw / 2;
	return {
		header: { frame_id: grid.frame, stamp },
		info: {
			map_load_time: stamp, resolution: grid.resolution, width: grid.width, height: grid.height,
			origin: { position: { x: grid.origin.x, y: grid.origin.y, z: 0 }, orientation: { x: 0, y: 0, z: Math.sin(half), w: Math.cos(half) } },
		},
		data: Array.from(data),
	};
}

// The mask as map_server reads it back in "raw" mode: a binary PGM whose pixels are the cell
// values (unknown, -1, is 255), top row first (the grid's last row).
export function toPgm(grid, data) {
	const header = new TextEncoder().encode(`P5\n# Vizanti costmap zones\n${grid.width} ${grid.height}\n255\n`);
	const out = new Uint8Array(header.length + grid.width * grid.height);
	out.set(header, 0);
	let i = header.length;
	for (let r = grid.height - 1; r >= 0; r--) {
		for (let c = 0; c < grid.width; c++)
			out[i++] = data[r * grid.width + c] & 0xff;
	}
	return out;
}

export function toYaml(name, grid) {
	const n = (v) => Number(v.toFixed(6));
	return [
		`image: ${name}.pgm`,
		"mode: raw",
		`resolution: ${n(grid.resolution)}`,
		`origin: [${n(grid.origin.x)}, ${n(grid.origin.y)}, ${n(grid.yaw)}]`,
		"negate: 0",
		"occupied_thresh: 0.65",
		"free_thresh: 0.25",
		"",
	].join("\n");
}

// "/keepout_filter_mask" -> "keepout_filter_mask"
export function fileName(maskTopic) {
	return String(maskTopic || "mask").replace(/^\/+/, "").replace(/[^\w-]+/g, "_") || "mask";
}

// the zones and the one being drawn, as markers (a MarkerArray display shows them)
export function zoneMarkers(zones, drawing, frame, stamp = { sec: 0, nanosec: 0 }) {
	const markers = [{ header: { frame_id: frame, stamp }, ns: "", id: 0, action: 3 }];
	const strip = (id, ns, points, closed, color) => ({
		header: { frame_id: frame, stamp }, ns, id, type: 4, action: 0,
		pose: { position: { x: 0, y: 0, z: 0 }, orientation: { x: 0, y: 0, z: 0, w: 1 } },
		scale: { x: 0.05, y: 0, z: 0 }, color,
		points: [...points, ...(closed && points.length ? [points[0]] : [])].map((p) => ({ x: p.x, y: p.y, z: 0.03 })),
		lifetime: { sec: 0, nanosec: 0 }, frame_locked: false, colors: [], text: "", mesh_resource: "", mesh_use_embedded_materials: false,
	});
	zones.forEach((z, i) => markers.push(strip(i + 1, "zones", z.points, true, z.keepout ? { r: 1, g: 0.23, b: 0.19, a: 1 } : { r: 1, g: 0.62, b: 0.04, a: 1 })));
	if (drawing.length)
		markers.push(strip(zones.length + 1, "drawing", drawing, false, { r: 0.35, g: 0.66, b: 1, a: 1 }));
	return { markers };
}

// a cheap fingerprint of a mask's cells, to know our own mask when it comes back on the topic
export function fingerprint(data) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < data.length; i++)
		h = Math.imul(h ^ (data[i] & 0xff), 16777619) >>> 0;
	return `${data.length}:${h}`;
}
