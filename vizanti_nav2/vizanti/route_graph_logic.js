// The Route Tool panel (nav2_rviz_plugins/Route Tool) without the page: a Nav2 route graph that
// is loaded from and saved to nav2_route's GeoJSON, edited by node and edge id, and drawn as
// nav2_route's markers (utils::toMsg). Pure, so it runs under node --test.
//
// Node and edge ids share one counter, as in RViz. Metadata and operations are kept as they were
// read and written back unchanged.

export class RouteGraph {

	constructor() {
		this.nodes = new Map(); // id -> { id, x, y, frame, metadata, operations }
		this.edges = new Map(); // id -> { id, start, end, cost, overridable, metadata, operations }
		this.nextId = 0;
	}

	// nav2_route GeoJSON (GeoJsonGraphFileLoader): Point features are nodes, the others edges.
	// Throws with a readable message when the file is not a graph.
	static fromGeoJson(text) {
		let doc;
		try {
			doc = JSON.parse(text);
		} catch (e) {
			throw new Error("The file is not JSON.");
		}
		if (!Array.isArray(doc?.features))
			throw new Error("The file has no GeoJSON features.");
		const graph = new RouteGraph();
		let maxId = -1;
		for (const f of doc.features) {
			const p = f?.properties ?? {};
			if (f?.geometry?.type !== "Point")
				continue;
			const [x, y] = f.geometry.coordinates ?? [];
			if (!Number.isInteger(p.id) || !Number.isFinite(x) || !Number.isFinite(y))
				throw new Error("A node needs an integer id and x, y coordinates.");
			graph.nodes.set(p.id, { id: p.id, x, y, frame: p.frame ?? "map", metadata: p.metadata, operations: p.operations });
			maxId = Math.max(maxId, p.id);
		}
		for (const f of doc.features) {
			const p = f?.properties ?? {};
			if (f?.geometry?.type === "Point")
				continue;
			if (!Number.isInteger(p.id) || !graph.nodes.has(p.startid) || !graph.nodes.has(p.endid))
				throw new Error(`Edge ${p.id} does not join two nodes of the graph.`);
			graph.edges.set(p.id, { id: p.id, start: p.startid, end: p.endid, cost: p.cost ?? 0, overridable: p.overridable ?? true, metadata: p.metadata, operations: p.operations });
			maxId = Math.max(maxId, p.id);
		}
		graph.nextId = maxId + 1;
		return graph;
	}

	// GeoJsonGraphFileSaver's output: the same keys, 4-space indented
	toGeoJson() {
		const features = [];
		for (const n of this.nodes.values()) {
			const properties = { id: n.id, frame: n.frame };
			if (n.metadata && Object.keys(n.metadata).length)
				properties.metadata = n.metadata;
			if (n.operations && Object.keys(n.operations).length)
				properties.operations = n.operations;
			features.push({ geometry: { coordinates: [n.x, n.y], type: "Point" }, properties, type: "Feature" });
		}
		for (const e of this.edges.values()) {
			const properties = { id: e.id, startid: e.start, endid: e.end };
			if (e.metadata && Object.keys(e.metadata).length)
				properties.metadata = e.metadata;
			if (e.operations && Object.keys(e.operations).length)
				properties.operations = e.operations;
			properties.cost = e.cost;
			properties.overridable = e.overridable;
			features.push({ geometry: { type: "MultiLineString" }, properties, type: "Feature" });
		}
		const doc = { crs: { properties: { name: "urn:ogc:def:crs:EPSG::3857" }, type: "name" }, features, name: "graph", type: "FeatureCollection" };
		return JSON.stringify(doc, null, 4) + "\n";
	}

	addNode(x, y) {
		const id = this.nextId++;
		this.nodes.set(id, { id, x, y, frame: "map" });
		return id;
	}

	addEdge(start, end) {
		this.need(start);
		this.need(end);
		const id = this.nextId++;
		this.edges.set(id, { id, start, end, cost: 0, overridable: true });
		return id;
	}

	editNode(id, x, y) {
		const node = this.need(id);
		node.x = x;
		node.y = y;
	}

	// another start and end for an edge; its cost and data stay
	editEdge(id, start, end) {
		const edge = this.edges.get(id);
		if (!edge)
			throw new Error(`There is no edge ${id}.`);
		this.need(start);
		this.need(end);
		edge.start = start;
		edge.end = end;
	}

	// the node and every edge to or from it
	removeNode(id) {
		this.need(id);
		this.nodes.delete(id);
		for (const [edgeId, e] of this.edges)
			if (e.start === id || e.end === id)
				this.edges.delete(edgeId);
	}

	removeEdge(id) {
		if (!this.edges.delete(id))
			throw new Error(`There is no edge ${id}.`);
	}

	need(id) {
		const node = this.nodes.get(id);
		if (!node)
			throw new Error(`There is no node ${id}.`);
		return node;
	}

	// nav2_route::utils::toMsg: red node spheres with their ids, green edges with theirs. A
	// DELETEALL first, so removed nodes and edges leave the view.
	markers(stamp = { sec: 0, nanosec: 0 }, frame = "map") {
		const header = { frame_id: frame, stamp };
		const point = (x, y) => ({ x, y, z: 0 });
		const pose = (x, y) => ({ position: point(x, y), orientation: { x: 0, y: 0, z: 0, w: 1 } });
		const base = { header, action: 0, pose: pose(0, 0), points: [], colors: [], text: "", lifetime: { sec: 0, nanosec: 0 }, frame_locked: false };
		const markers = [{ header, action: 3, ns: "", id: 0 }];
		const nodes = { ...base, ns: "route_graph_nodes", id: 0, type: 7, scale: { x: 0.1, y: 0.1, z: 0.1 }, color: { r: 1, g: 0, b: 0, a: 1 }, points: [] };
		const edges = { ...base, ns: "route_graph_edges", id: 0, type: 5, scale: { x: 0.05, y: 0, z: 0 }, color: { r: 0, g: 1, b: 0, a: 0.5 }, points: [] };
		let nodeLabel = 0, edgeLabel = 0;
		for (const n of this.nodes.values()) {
			nodes.points.push(point(n.x, n.y));
			markers.push({ ...base, ns: "route_graph_node_ids", id: ++nodeLabel, type: 9, pose: pose(n.x + 0.07, n.y), scale: { x: 0.1, y: 0.1, z: 0.1 }, color: { r: 1, g: 0, b: 0, a: 1 }, text: String(n.id) });
			for (const e of this.edges.values()) {
				if (e.start !== n.id)
					continue;
				const to = this.nodes.get(e.end);
				edges.points.push(point(n.x, n.y), point(to.x, to.y));
				const yOffset = n.id > to.id ? 0.05 : -0.05;
				markers.push({ ...base, ns: "route_graph_edge_ids", id: ++edgeLabel, type: 9, pose: pose(n.x + (to.x - n.x) / 2 + 0.07, n.y + (to.y - n.y) / 2 + yOffset), scale: { x: 0.1, y: 0.1, z: 0.1 }, color: { r: 0, g: 1, b: 0, a: 1 }, text: String(e.id) });
			}
		}
		markers.push(edges, nodes);
		return { markers };
	}
}

// a typed field: a number, or null when it is not one
export function parseNumber(text) {
	const t = String(text ?? "").trim();
	if (t === "")
		return null;
	const n = Number(t);
	return Number.isFinite(n) ? n : null;
}

export function parseId(text) {
	const n = parseNumber(text);
	return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}
