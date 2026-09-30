export const MIN_ZOOM = 7;
export const MAX_ZOOM = 19;

// Web-mercator zoom level that suits a view scale in pixels per metre.
export function zoomForScale(pixelsPerMeter) {
	if (!(pixelsPerMeter > 0))
		return 17;
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(Math.log2(pixelsPerMeter) + 17)));
}

// Tiles in the inclusive range, nearest the centre first so the middle of the view loads first.
// Returns null when the range holds more than maxTiles tiles.
export function tileList(minX, maxX, minY, maxY, maxTiles) {
	if (maxX < minX || maxY < minY)
		return [];
	if ((maxX - minX + 1) * (maxY - minY + 1) > maxTiles)
		return null;
	const cx = Math.round((minX + maxX) / 2), cy = Math.round((minY + maxY) / 2);
	const list = [];
	for (let x = minX; x <= maxX; x++) {
		for (let y = minY; y <= maxY; y++)
			list.push({ x, y });
	}
	list.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
	return list;
}

// The ancestor `levels` zoom levels up that contains tile (x, y), and which part of its
// image covers the tile: u0/v0 from the image's top-left corner, as fractions.
export function parentCrop(x, y, levels) {
	const n = 1 << levels;
	return { x: x >> levels, y: y >> levels, u0: (x % n) / n, v0: (y % n) / n, size: 1 / n };
}

export function tileUrl(template, z, x, y) {
	return template.replace("{z}", z).replace("{x}", x).replace("{y}", y);
}

export function wrapTileX(x, z) {
	const n = 1 << z;
	return ((x % n) + n) % n;
}
