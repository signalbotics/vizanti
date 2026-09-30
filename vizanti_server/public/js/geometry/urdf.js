// URDF parsing without a DOM, so it can run and be tested anywhere.

const ENTITIES = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
const unescape = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (m) => ENTITIES[m]);

// A minimal XML reader: elements and attributes only, which is all URDF needs.
// Returns the root element as { tag, attrs, children }.
export function parseXml(text) {
	const source = String(text)
		.replace(/<!--[\s\S]*?-->/g, "")
		.replace(/<\?[\s\S]*?\?>/g, "")
		.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "")
		.replace(/<!DOCTYPE[^>]*>/gi, "");

	const tagPattern = /<\s*(\/?)\s*([A-Za-z_][\w:.-]*)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)\s*>/g;
	const attrPattern = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

	let root = null;
	const stack = [];
	let match;
	while ((match = tagPattern.exec(source)) !== null) {
		const [, closing, tag, attrText, selfClosing] = match;
		if (closing) {
			const open = stack.pop();
			if (!open || open.tag !== tag)
				throw new Error(`Malformed XML: closing tag </${tag}> does not match <${open ? open.tag : "nothing"}>.`);
			continue;
		}
		const element = { tag, attrs: {}, children: [] };
		let attr;
		while ((attr = attrPattern.exec(attrText)) !== null)
			element.attrs[attr[1]] = unescape(attr[2] ?? attr[3]);

		if (stack.length)
			stack[stack.length - 1].children.push(element);
		else if (!root)
			root = element;
		if (!selfClosing)
			stack.push(element);
	}
	if (!root)
		throw new Error("Malformed XML: no root element.");
	if (stack.length)
		throw new Error(`Malformed XML: <${stack[stack.length - 1].tag}> is never closed.`);
	return root;
}

const child = (element, tag) => element.children.find((c) => c.tag === tag);

// "1 2 3" -> [1, 2, 3], or null when it is not `count` finite numbers
function numbers(text, count) {
	if (typeof text !== "string")
		return null;
	const parts = text.trim().split(/\s+/).map(Number);
	return parts.length === count && parts.every(Number.isFinite) ? parts : null;
}

function origin(element) {
	const node = child(element, "origin");
	if (!node)
		return { xyz: [0, 0, 0], rpy: [0, 0, 0] };
	const xyz = node.attrs.xyz === undefined ? [0, 0, 0] : numbers(node.attrs.xyz, 3);
	const rpy = node.attrs.rpy === undefined ? [0, 0, 0] : numbers(node.attrs.rpy, 3);
	return xyz && rpy ? { xyz, rpy } : null;
}

function geometry(element) {
	const node = child(element, "geometry");
	const shape = node?.children[0];
	if (!shape)
		return null;
	const number = (name) => {
		const value = Number(shape.attrs[name]);
		return shape.attrs[name] !== undefined && Number.isFinite(value) ? value : null;
	};
	switch (shape.tag) {
		case "box": {
			const size = numbers(shape.attrs.size, 3);
			return size ? { type: "box", size } : null;
		}
		case "cylinder": {
			const radius = number("radius"), length = number("length");
			return radius !== null && length !== null ? { type: "cylinder", radius, length } : null;
		}
		case "sphere": {
			const radius = number("radius");
			return radius !== null ? { type: "sphere", radius } : null;
		}
		case "mesh": {
			if (!shape.attrs.filename)
				return null;
			const scale = shape.attrs.scale === undefined ? [1, 1, 1] : numbers(shape.attrs.scale, 3);
			return scale ? { type: "mesh", filename: shape.attrs.filename, scale } : null;
		}
	}
	return null;
}

// Parses a URDF document into
//   { name, links: { [name]: { visuals: [...], collisions: [...] } }, skipped }
// Each visual/collision is { origin: { xyz, rpy }, geometry, color: [r,g,b,a] | null }.
// Shapes that cannot be read are counted in `skipped` and left out.
export function parseUrdf(text) {
	const root = parseXml(text);
	if (root.tag !== "robot")
		throw new Error(`This is not a URDF: the root element is <${root.tag}>, expected <robot>.`);

	const colorOf = (material) => {
		const color = material && child(material, "color");
		return color ? numbers(color.attrs.rgba, 4) : null;
	};

	// materials declared once at the top and referred to by name
	const named = {};
	for (const material of root.children.filter((c) => c.tag === "material")) {
		const color = colorOf(material);
		if (material.attrs.name && color)
			named[material.attrs.name] = color;
	}

	const robot = { name: root.attrs.name ?? "", links: {}, skipped: 0 };
	for (const link of root.children.filter((c) => c.tag === "link")) {
		if (!link.attrs.name)
			continue;
		const entry = { visuals: [], collisions: [] };
		for (const part of link.children) {
			if (part.tag !== "visual" && part.tag !== "collision")
				continue;
			const at = origin(part);
			const shape = geometry(part);
			if (!at || !shape) {
				robot.skipped++;
				continue;
			}
			const material = child(part, "material");
			const color = colorOf(material) ?? (material?.attrs.name ? named[material.attrs.name] ?? null : null);
			(part.tag === "visual" ? entry.visuals : entry.collisions).push({ origin: at, geometry: shape, color });
		}
		robot.links[link.attrs.name] = entry;
	}
	return robot;
}

// URDF rotations are fixed-axis roll (x), pitch (y), yaw (z)
export function rpyToQuat([roll, pitch, yaw]) {
	const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
	const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
	const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
	return {
		x: sr * cp * cy - cr * sp * sy,
		y: cr * sp * cy + sr * cp * sy,
		z: cr * cp * sy - sr * sp * cy,
		w: cr * cp * cy + sr * sp * sy,
	};
}

const MESH_FORMATS = { stl: "stl", dae: "dae", obj: "obj" };

// Where the server serves a mesh from, and which loader reads it. Only package:// URIs
// without parent-directory steps are served; anything else gives null.
export function meshUrl(filename, baseUrl) {
	if (typeof filename !== "string")
		return null;
	const match = /^package:\/\/([\w.-]+)\/(.+)$/.exec(filename);
	if (!match)
		return null;
	const [, pkg, path] = match;
	if (path.split("/").some((part) => part === ".." || part === ""))
		return null;
	const format = MESH_FORMATS[path.split(".").pop().toLowerCase()];
	if (!format)
		return null;
	return { url: `${baseUrl}/package/${pkg}/${path}`, format };
}
