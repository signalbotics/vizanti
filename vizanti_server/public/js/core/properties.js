export const LEAF_TYPES = ["topic", "frame", "bool", "int", "float", "color", "enum", "string", "object", "array"];

const TYPE_DEFAULTS = { topic: "", frame: "", bool: false, int: 0, float: 0, color: "#ffffff", string: "" };
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export function enumValues(def) {
	return def.options.map((o) => (o !== null && typeof o === "object" ? o.value : o));
}

// Groups only affect layout; values are stored flat by leaf key.
export function flattenSchema(schema) {
	const out = {};
	const walk = (props) => {
		for (const [key, def] of Object.entries(props)) {
			if (def.type === "group") {
				walk(def.properties ?? {});
				continue;
			}
			if (!LEAF_TYPES.includes(def.type))
				throw new Error(`Property "${key}": unknown type "${def.type}"`);
			if (key in out)
				throw new Error(`Property "${key}" is declared twice`);
			if (def.type === "enum" && (!Array.isArray(def.options) || def.options.length === 0))
				throw new Error(`Property "${key}": enum needs a non-empty options list`);
			out[key] = def;
		}
	};
	walk(schema);
	return out;
}

export function defaultOf(def) {
	if (def.default !== undefined)
		return structuredClone(def.default);
	if (def.type === "enum")
		return enumValues(def)[0];
	if (def.type === "object")
		return {};
	if (def.type === "array")
		return [];
	return TYPE_DEFAULTS[def.type];
}

export function defaultsOf(schema) {
	const out = {};
	for (const [key, def] of Object.entries(flattenSchema(schema)))
		out[key] = defaultOf(def);
	return out;
}

function coerceNumber(def, value) {
	if (typeof value === "string" && value.trim() === "")
		return { ok: false, error: "Enter a number." };
	if (typeof value !== "number" && typeof value !== "string")
		return { ok: false, error: "Enter a number." };
	let n = Number(value);
	if (!Number.isFinite(n))
		return { ok: false, error: "Enter a number." };
	if (def.type === "int")
		n = Math.round(n);
	if (typeof def.min === "number" && n < def.min)
		n = def.min;
	if (typeof def.max === "number" && n > def.max)
		n = def.max;
	return { ok: true, value: n };
}

export function coerce(def, value) {
	switch (def.type) {
		case "int":
		case "float":
			return coerceNumber(def, value);
		case "bool":
			if (value === true || value === "true") return { ok: true, value: true };
			if (value === false || value === "false") return { ok: true, value: false };
			return { ok: false, error: "Must be true or false." };
		case "color":
			if (typeof value === "string" && COLOR_RE.test(value)) return { ok: true, value: value.toLowerCase() };
			return { ok: false, error: "Must be a colour like #1a2b3c." };
		case "enum": {
			const match = enumValues(def).find((v) => String(v) === String(value));
			if (match !== undefined && value !== null && value !== undefined) return { ok: true, value: match };
			return { ok: false, error: "Not one of the allowed options." };
		}
		case "string":
		case "topic":
		case "frame":
			if (typeof value === "string") return { ok: true, value };
			return { ok: false, error: "Must be text." };
		case "object":
			if (value !== null && typeof value === "object" && !Array.isArray(value)) return { ok: true, value };
			return { ok: false, error: "Must be an object." };
		case "array":
			if (Array.isArray(value)) return { ok: true, value };
			return { ok: false, error: "Must be a list." };
	}
	return { ok: false, error: `Unknown property type "${def.type}".` };
}

// Builds the full value set for a new instance from whatever was saved.
export function resolveProps(schema, saved) {
	const values = {};
	const rejected = [];
	const source = saved !== null && typeof saved === "object" ? saved : {};
	for (const [key, def] of Object.entries(flattenSchema(schema))) {
		if (key in source) {
			const r = coerce(def, source[key]);
			if (r.ok) {
				values[key] = r.value;
				continue;
			}
			rejected.push(key);
		}
		values[key] = defaultOf(def);
	}
	return { values, rejected };
}
