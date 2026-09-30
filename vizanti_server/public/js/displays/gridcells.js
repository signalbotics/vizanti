import { Display } from '../core/display.js';
import { FlatMesh } from '../core/flat_mesh.js';
import { cellQuads } from '../geometry/shapes.js';

export class GridCellsDisplay extends Display {

	static type = "gridcells";
	static label = "Grid Cells";
	static icon = "assets/gridcells.svg";
	static description = "nav_msgs/GridCells";
	static msgTypes = ["nav_msgs/msg/GridCells"];

	// more cells than this are thinned, with a warning
	static budget = 50000;

	static properties = {
		topic: { type: "topic", label: "Topic" },
		opacity: { type: "float", label: "Opacity", default: 1.0, min: 0.1, max: 1, step: 0.05, slider: true },
		color: { type: "color", label: "Colour", default: "#74ce6c" },
		throttle: { type: "int", label: "Socket throttle (ms)", default: 500, min: 0, max: 10000 },
		use_timestamp: {
			type: "bool", label: "Use Timestamp", default: false,
			help: "Rendering fixed objects at their published timestamp causes them to lag behind when focusing on frames other than the map frame. Rviz uses the latest timestamp instead, which this emulates. Enable for technically correct rendering.",
		},
	};

	onCreate() {
		this.cells = new FlatMesh(this.props.color, this.props.opacity);
		this.add(this.cells.mesh);
	}

	onMessage(msg) {
		if (msg.cells === undefined || msg.cells.length === 0) {
			this.status.warn("Received empty grid. Oh no! Anyway...");
			this.cells.setTriangles(new Float32Array(0));
			return;
		}
		if (msg.cell_width === 0 || msg.cell_height === 0) {
			this.status.error(`Grid cell size must be nonzero, received width=${msg.cell_width} height=${msg.cell_height}.`);
			this.cells.setTriangles(new Float32Array(0));
			return;
		}
		if (!this.setFrame(msg.header, { follow: !this.props.use_timestamp })) {
			this.cells.setTriangles(new Float32Array(0));
			return;
		}

		const result = cellQuads(msg.cells, msg.cell_width, msg.cell_height, GridCellsDisplay.budget);
		this.cells.setTriangles(result.positions);
		this.setInfo({ "Frame": msg.header.frame_id, "Cells": msg.cells.length });
		if (result.stride > 1)
			this.status.warn(`Showing every ${result.stride}th cell: ${msg.cells.length} cells is over the ${GridCellsDisplay.budget} limit.`);
	}

	onPropertyChange(key, value) {
		if (key === "color")
			this.cells.material.color.set(value);
		if (key === "opacity")
			this.cells.material.opacity = value;
		if (key === "use_timestamp" && this.lastMsg)
			this.setFrame(this.lastMsg.header, { follow: !value });
		if (key === "topic") {
			this.cells.setTriangles(new Float32Array(0));
			this.setInfo({});
		}
	}

	onDestroy() {
		this.cells.dispose();
	}
}
