// Reads an RViz (.rviz) config and turns it into Vizanti displays, global options and a
// camera. RViz writes block-style YAML, so a small parser for that subset is enough.

// ---------------------------------------------------------------- YAML subset

function stripComment(line) {
	let quote = "";
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quote) {
			if (c === quote)
				quote = "";
		} else if (c === "'" || c === '"') {
			quote = c;
		} else if (c === "#" && (i === 0 || line[i - 1] === " " || line[i - 1] === "\t")) {
			return line.slice(0, i);
		}
	}
	return line;
}

function toLines(text) {
	const out = [];
	for (const raw of text.split(/\r?\n/)) {
		const line = stripComment(raw).replace(/\s+$/, "");
		const content = line.trimStart();
		if (content === "" || content === "---" || content === "...")
			continue;
		out.push({ indent: line.length - content.length, text: content });
	}
	return out;
}

const isListItem = (text) => text === "-" || text.startsWith("- ");

// "key: rest" -> { key, rest }, or null when the text is not a mapping entry.
function splitKey(text) {
	if (text.startsWith("[") || text.startsWith("{"))
		return null;
	let keyEnd;
	let from = 0;
	if (text.startsWith("'") || text.startsWith('"')) {
		const close = text.indexOf(text[0], 1);
		if (close === -1)
			return null;
		from = close + 1;
	}
	for (let i = from; i < text.length; i++) {
		if (text[i] === ":" && (i + 1 === text.length || text[i + 1] === " ")) {
			keyEnd = i;
			break;
		}
	}
	if (keyEnd === undefined)
		return null;
	const rawKey = text.slice(0, keyEnd).trim();
	const key = from ? scalar(rawKey) : rawKey;
	return { key: String(key), rest: text.slice(keyEnd + 1).trim() };
}

function splitFlow(inner) {
	const parts = [];
	let quote = "";
	let start = 0;
	for (let i = 0; i < inner.length; i++) {
		const c = inner[i];
		if (quote) {
			if (c === quote)
				quote = "";
		} else if (c === "'" || c === '"') {
			quote = c;
		} else if (c === ",") {
			parts.push(inner.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(inner.slice(start));
	return parts.map((p) => p.trim()).filter((p) => p !== "");
}

function scalar(text) {
	if (text.length >= 2 && text.startsWith("'") && text.endsWith("'"))
		return text.slice(1, -1).replace(/''/g, "'");
	if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
		try {
			return JSON.parse(text);
		} catch (e) {
			return text.slice(1, -1);
		}
	}
	if (text.startsWith("[") && text.endsWith("]"))
		return splitFlow(text.slice(1, -1)).map(scalar);
	if (text.startsWith("{") && text.endsWith("}")) {
		const obj = {};
		for (const part of splitFlow(text.slice(1, -1))) {
			const entry = splitKey(part);
			if (entry)
				obj[entry.key] = scalar(entry.rest);
		}
		return obj;
	}
	if (text === "~" || /^null$/i.test(text))
		return null;
	if (/^true$/i.test(text))
		return true;
	if (/^false$/i.test(text))
		return false;
	if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text))
		return Number(text);
	return text;
}

// The value that starts at lines[i]: a nested block when the next line is deeper, or null.
function nested(lines, i, indent) {
	if (i < lines.length && lines[i].indent > indent && !isListItem(lines[i].text) && !splitKey(lines[i].text))
		return [scalar(lines[i].text), i + 1]; // a value on its own line, e.g. "{}" under a key
	if (i < lines.length && (lines[i].indent > indent || (lines[i].indent === indent && isListItem(lines[i].text))))
		return block(lines, i, lines[i].indent);
	return [null, i];
}

function block(lines, i, indent) {
	return isListItem(lines[i].text) ? list(lines, i, indent) : map(lines, i, indent);
}

function map(lines, i, indent) {
	const obj = {};
	while (i < lines.length && lines[i].indent === indent && !isListItem(lines[i].text)) {
		const entry = splitKey(lines[i].text);
		if (!entry)
			throw new Error(`Line "${lines[i].text}" is not a "key: value" entry.`);
		i++;
		if (entry.rest !== "")
			obj[entry.key] = scalar(entry.rest);
		else
			[obj[entry.key], i] = nested(lines, i, indent);
	}
	return [obj, i];
}

function list(lines, i, indent) {
	const arr = [];
	while (i < lines.length && lines[i].indent === indent && isListItem(lines[i].text)) {
		const rest = lines[i].text.slice(1).trimStart();
		if (rest === "") {
			let value;
			[value, i] = nested(lines, i + 1, indent);
			arr.push(value);
		} else if (splitKey(rest)) {
			// "- key: value" opens a map whose keys line up with "key"
			const inner = indent + (lines[i].text.length - rest.length);
			lines[i] = { indent: inner, text: rest };
			let value;
			[value, i] = map(lines, i, inner);
			arr.push(value);
		} else {
			arr.push(scalar(rest));
			i++;
		}
	}
	return [arr, i];
}

export function parseYaml(text) {
	const lines = toLines(String(text));
	if (lines.length === 0)
		return null;
	if (lines.length === 1 && !splitKey(lines[0].text) && !isListItem(lines[0].text))
		return scalar(lines[0].text);
	const [value, next] = block(lines, 0, lines[0].indent);
	if (next < lines.length)
		throw new Error(`Unexpected indentation at "${lines[next].text}".`);
	return value;
}

// ---------------------------------------------------------------- RViz -> Vizanti

export function rvizColor(value) {
	if (typeof value !== "string")
		return undefined;
	const parts = value.split(";").map((p) => Number(p.trim()));
	if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p)))
		return undefined;
	return "#" + parts.map((p) => Math.round(Math.min(255, Math.max(0, p))).toString(16).padStart(2, "0")).join("");
}

export function isRvizConfig(doc) {
	return doc !== null && typeof doc === "object" && !Array.isArray(doc)
		&& doc["Visualization Manager"] !== null && typeof doc["Visualization Manager"] === "object";
}

// RViz 2 stores a topic as { Value: "/scan", Depth: ..., ... }; RViz 1 as a plain string.
function topicOf(value) {
	const topic = typeof value === "string" ? value : value?.Value;
	return typeof topic === "string" && topic !== "" ? topic : undefined;
}

// RViz stores floats as float32, so 0.01 comes back as 0.009999999776482582
const num = (value) => (typeof value === "number" && Number.isFinite(value) ? Number(value.toPrecision(7)) : undefined);
const bool = (value) => (typeof value === "boolean" ? value : undefined);
const str = (value) => (typeof value === "string" && value !== "" ? value : undefined);
const flatColor = (d) => d["Color Transformer"] === "FlatColor";

// class name (without package) -> [vizanti type, props from the RViz display]
const MAPPINGS = {
	Grid: ["grid", (d) => ({ size: num(d["Cell Size"]), colour: rvizColor(d.Color) })],
	TF: ["tf", (d) => ({
		show_names: bool(d["Show Names"]), show_axes: bool(d["Show Axes"]),
		show_lines: bool(d["Show Arrows"]), scale: num(d["Marker Scale"]),
	})],
	LaserScan: ["scan", (d) => ({
		topic: topicOf(d.Topic), color: flatColor(d) ? rvizColor(d.Color) : undefined,
		thickness: num(d["Size (m)"]), opacity: num(d.Alpha),
	})],
	PointCloud2: ["pointcloud", (d) => ({
		topic: topicOf(d.Topic), thickness: num(d["Size (m)"]), opacity: num(d.Alpha),
		color: flatColor(d) ? rvizColor(d.Color) : undefined, colour_override: flatColor(d) || undefined,
	})],
	Map: ["map", (d) => ({ topic: topicOf(d.Topic), opacity: num(d.Alpha) })],
	MarkerArray: ["markerarray", (d) => ({ topic: topicOf(d.Topic) })],
	Marker: ["marker", (d) => ({ topic: topicOf(d.Topic) })],
	Path: ["path", (d) => ({ topic: topicOf(d.Topic), color: rvizColor(d.Color), opacity: num(d.Alpha) })],
	PoseArray: ["posearray", (d) => ({ topic: topicOf(d.Topic), color: rvizColor(d.Color) })],
	Pose: ["posewithcovariancestamped", (d) => ({
		topic: topicOf(d.Topic), topic_type: "geometry_msgs/msg/PoseStamped", color: rvizColor(d.Color),
	})],
	PoseWithCovariance: ["posewithcovariancestamped", (d) => ({
		topic: topicOf(d.Topic), topic_type: "geometry_msgs/msg/PoseWithCovarianceStamped", color: rvizColor(d.Color),
	})],
	Odometry: ["odom", (d) => ({ topic: topicOf(d.Topic), color: rvizColor(d.Shape?.Color ?? d.Color) })],
	Range: ["range", (d) => ({ topic: topicOf(d.Topic), opacity: num(d.Alpha) })],
	GridCells: ["gridcells", (d) => ({ topic: topicOf(d.Topic), color: rvizColor(d.Color), opacity: num(d.Alpha) })],
	RobotModel: ["urdf", (d) => ({
		topic: topicOf(d["Description Topic"]), opacity: num(d.Alpha),
		show_visual: bool(d["Visual Enabled"]), show_collision: bool(d["Collision Enabled"]),
		tf_prefix: str(d["TF Prefix"]),
	})],
	Axes: ["axes", (d) => ({
		frame: str(d["Reference Frame"]) === "<Fixed Frame>" ? undefined : str(d["Reference Frame"]),
		length: num(d.Length), radius: num(d.Radius), opacity: num(d.Alpha),
	})],
	Image: ["image", (d) => ({ topic: topicOf(d.Topic) })],
	Camera: ["camera", (d) => ({ topic: topicOf(d.Topic), opacity: num(d["Overlay Alpha"]) })],
	DepthCloud: ["depthcloud", (d) => ({ topic: topicOf(d["Depth Map Topic"]), opacity: num(d.Alpha) })],
	PointStamped: ["pointstamped", (d) => ({
		topic: topicOf(d.Topic), color: rvizColor(d.Color), radius: num(d.Radius),
		history: num(d["History Length"]), opacity: num(d.Alpha),
	})],
	Polygon: ["polygon", (d) => ({ topic: topicOf(d.Topic), color: rvizColor(d.Color), opacity: num(d.Alpha) })],
	Wrench: ["wrench", (d) => ({
		topic: topicOf(d.Topic), topic_type: "geometry_msgs/msg/WrenchStamped",
		linear_color: rvizColor(d["Force Color"]), angular_color: rvizColor(d["Torque Color"]),
		opacity: num(d.Alpha),
	})],
	InteractiveMarkers: ["interactivemarkers", (d) => ({
		namespace: str(d["Interactive Markers Namespace"]),
		show_descriptions: bool(d["Show Descriptions"]), show_axes: bool(d["Show Axes"]),
	})],
};

function defined(props) {
	return Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined));
}

function convertView(view) {
	if (view === null || typeof view !== "object" || typeof view.Class !== "string")
		return undefined;
	const kind = view.Class.split("/").pop();
	const frame = str(view["Target Frame"]);
	const target_frame = frame === undefined || frame === "<Fixed Frame>" ? "" : frame;

	if (kind === "TopDownOrtho") {
		return {
			mode: "topdown", target_frame,
			topdown: { x: num(view.X) ?? 0, y: num(view.Y) ?? 0, zoom: num(view.Scale) ?? 50 },
		};
	}
	if (kind === "Orbit" || kind === "XYOrbit" || kind === "ThirdPersonFollower") {
		const focal = view["Focal Point"] ?? {};
		const target = [num(focal.X) ?? 0, num(focal.Y) ?? 0, num(focal.Z) ?? 0];
		const distance = num(view.Distance) ?? 10;
		const pitch = num(view.Pitch) ?? 0.785;
		const yaw = num(view.Yaw) ?? 0.785;
		const position = [
			target[0] + distance * Math.cos(pitch) * Math.cos(yaw),
			target[1] + distance * Math.cos(pitch) * Math.sin(yaw),
			target[2] + distance * Math.sin(pitch),
		];
		const camera = { mode: "orbit", target_frame, orbit: { target, position } };
		if (kind === "ThirdPersonFollower")
			camera.follow_yaw = true;
		return camera;
	}
	if (kind === "FPS") {
		const p = view.Position ?? {};
		const position = [num(p.X) ?? 0, num(p.Y) ?? 0, num(p.Z) ?? 1];
		const pitch = num(view.Pitch) ?? 0;
		const yaw = num(view.Yaw) ?? 0;
		// RViz's FPS pitch is positive looking down
		const target = [
			position[0] + Math.cos(pitch) * Math.cos(yaw),
			position[1] + Math.cos(pitch) * Math.sin(yaw),
			position[2] - Math.sin(pitch),
		];
		return { mode: "fps", target_frame, orbit: { target, position } };
	}
	return undefined; // other views have no Vizanti equivalent
}

// types: anything with has(type), e.g. the registry's type Map.
export function convertRvizConfig(doc, types) {
	const vm = doc?.["Visualization Manager"] ?? {};
	const out = { items: [], global: {}, camera: undefined, skipped: [] };

	const options = vm["Global Options"];
	if (options !== null && typeof options === "object") {
		const fixed = str(options["Fixed Frame"]);
		if (fixed !== undefined)
			out.global.fixed_frame = fixed;
		const background = rvizColor(options["Background Color"]);
		if (background !== undefined)
			out.global.background = background;
	}

	let n = 0;
	const walk = (displays, parentEnabled) => {
		for (const d of Array.isArray(displays) ? displays : []) {
			if (d === null || typeof d !== "object" || typeof d.Class !== "string")
				continue;
			const kind = d.Class.split("/").pop();
			const enabled = parentEnabled && d.Enabled !== false;
			const name = str(d.Name) ?? kind;
			if (kind === "Group") {
				walk(d.Displays, enabled);
				continue;
			}
			const mapping = MAPPINGS[kind];
			if (!mapping || !types.has(mapping[0])) {
				out.skipped.push(`${name} (${d.Class})`);
				continue;
			}
			const [type, read] = mapping;
			out.items.push({ id: `${type}_rviz_${n++}`, type, name, enabled, container: "", props: defined(read(d)) });
		}
	};
	walk(vm.Displays, true);

	out.camera = convertView(vm.Views?.Current);
	return out;
}
