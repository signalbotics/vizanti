import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';
import { rotateVector } from '../geometry/tf.js';
import { zoomForScale, tileList, parentCrop, tileUrl, wrapTileX, MIN_ZOOM } from '../geometry/tiles.js';

const COVARIANCE_TYPE = { 0: "(unknown)", 1: "(approximated)", 2: "(diagonal known)", 3: "(known)" };
const MAX_TILES = 220;

// Map tiles laid out on a local tangent plane (ENU, REP 103) anchored at a NavSatFix.
export class SatelliteDisplay extends Display {

	static type = "satelite";
	static label = "Satellite Tiles";
	static icon = "assets/satelite.svg";
	static drawLayer = -2;
	static description = "sensor_msgs/NavSatFix";
	static msgTypes = ["sensor_msgs/msg/NavSatFix"];

	static properties = {
		topic: {
			type: "topic", label: "Topic",
			help: "Uses an ENU local tangent plane as specified by REP 103. The tiles are reprojected to match, which maintains alignment between geodetic coordinates and metric X,Y positions (it's basically a perpendicular globe at the given location). As the tangent plane increasingly diverges from the terrain with distance, Z offsets become larger and straight-line distances less useful. For best results, place the ENU origin near the operating area.",
		},
		server_url: {
			type: "string", label: "Tile server URL", default: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
			suggestions: [
				"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
				"https://tiles.stadiamaps.com/tiles/outdoors/{z}/{x}/{y}.png",
				"https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
				"https://t1.openseamap.org/seamark/{z}/{x}/{y}.png",
			],
			help: "The tile server can be changed to anything that uses 256x256 sized tiles, the Web Mercator projection, and follows the same {x},{y},{z} convention.",
		},
		smoothing: {
			type: "bool", label: "Texture smoothing", default: true,
			help: "Max tile zoom doesn't provide much detail up close, so you get to choose between pixelated or blurry.",
		},
		ignore_rotation: {
			type: "bool", label: "Ignore tf rotations", default: true,
			help: "Displaying the map with 0 yaw rotation can make viewing raw NavSatFix data from receivers more stable, but don't expect the robot to be facing the right way.",
		},
		opacity: { type: "float", label: "Opacity", default: 0.7, min: 0, max: 1, step: 0.05, slider: true },
	};

	get iconColor() {
		return null;
	}

	onCreate() {
		this.holder = new THREE.Group();
		this.add(this.holder);
		this.tiles = new Map(); // key -> { mesh, url, loaded }
		this.textures = new Map(); // url -> THREE.Texture
		this.fix = null;
		this.origin = null;
		this.anchor = null;
		this.reanchor = false;
		this.lastFixTime = 0;
		this.pending = false;
		this.navsat = null;
		this.Navsat = null;

		this.onTiles = () => this.schedule();
		window.addEventListener("navsat_tilecache_updated", this.onTiles);

		// the tile cache lives in IndexedDB and is shared by every satellite display
		import('../modules/navsat.js').then((module) => {
			this.navsatModule = module;
			this.navsat = module.navsat;
			this.Navsat = module.Navsat;
			this.schedule();
		}).catch((e) => {
			this.status.error("The tile cache could not be opened: " + e.message);
		});
	}

	schedule() {
		if (this.pending || !this.enabled)
			return;
		this.pending = true;
		setTimeout(() => {
			this.pending = false;
			if (this._alive)
				this._safe("rebuild");
		}, 60);
	}

	onMessage(msg) {
		// reduces jitter and CPU load with raw receivers
		if (Date.now() - this.lastFixTime < 4000 || this.props.opacity === 0) {
			this.status.touched = true;
			return;
		}
		this.lastFixTime = Date.now();

		const cov = msg.position_covariance ?? [];
		const info = {};
		if (msg.latitude != null) info["Latitude"] = msg.latitude.toFixed(8) + "°";
		if (msg.longitude != null) info["Longitude"] = msg.longitude.toFixed(8) + "°";
		if (msg.altitude != null) info["Altitude"] = msg.altitude.toFixed(2) + " m";
		info["Ground Covariance"] = Math.hypot(Math.sqrt(cov[0]), Math.sqrt(cov[4])).toFixed(2) + " m " + (COVARIANCE_TYPE[msg.position_covariance_type] ?? "");
		info["TF Frame"] = msg.header.frame_id;
		this.setInfo(info);

		if (msg.status?.status === -1 || !Number.isFinite(msg.latitude) || !Number.isFinite(msg.longitude)) {
			this.status.warn("No fix.");
			return;
		}

		const frame = msg.header.frame_id === "" ? this.ctx.tf.fixed_frame : msg.header.frame_id;
		if (!this.ctx.tf.absoluteTransforms[frame] && frame !== this.ctx.tf.fixed_frame) {
			this.status.error(`Required transform frame "${frame}" not found.`);
			return;
		}

		this.fix = { latitude: msg.latitude, longitude: msg.longitude, altitude: Number.isFinite(msg.altitude) ? msg.altitude : 0, frame };
		// Re-anchor the tangent plane only when the fix moved by more than receiver jitter.
		// The old tiles stay on screen until rebuild() replaces them in the same frame.
		const moved = !this.anchor || this.Navsat === null
			|| this.Navsat.haversine(this.anchor.latitude, this.anchor.longitude, msg.latitude, msg.longitude) > 0.25
			|| Math.abs(this.anchor.altitude - this.fix.altitude) > 1;
		if (moved) {
			this.anchor = { ...this.fix };
			this.origin = null;
			this.reanchor = true;
		}
		this.schedule();
	}

	// where the fix frame is, in the fixed frame; rotation dropped when asked to
	framePose() {
		const abs = this.ctx.tf.absoluteTransforms[this.fix.frame]
			?? { translation: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0, w: 1 } };
		const rotation = this.props.ignore_rotation ? { x: 0, y: 0, z: 0, w: 1 } : abs.rotation;
		return { translation: abs.translation, rotation };
	}

	rebuild() {
		if (!this.fix || !this.Navsat || this.props.opacity === 0) {
			this.holder.visible = false;
			return;
		}
		const Navsat = this.Navsat;
		const scene = this.ctx.scene;
		this.anchor ??= { ...this.fix };
		this.origin ??= Navsat.buildEnuOrigin(this.anchor.latitude, this.anchor.longitude, this.anchor.altitude);
		if (this.reanchor) {
			this.reanchor = false;
			this.clearMeshes(); // their corners were computed for the old anchor; textures are kept
		}

		const pose = this.framePose();
		this.holder.position.set(pose.translation.x, pose.translation.y, pose.translation.z);
		this.holder.quaternion.set(pose.rotation.x, pose.rotation.y, pose.rotation.z, pose.rotation.w);
		this.holder.visible = true;

		// the patch of ground in view, as a box around the point the camera looks at
		const target = scene.viewTarget();
		const radius = scene.viewRadiusMeters();
		const inverse = { x: -pose.rotation.x, y: -pose.rotation.y, z: -pose.rotation.z, w: pose.rotation.w };
		const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
			const d = [target.x + sx * radius - pose.translation.x, target.y + sy * radius - pose.translation.y, -pose.translation.z];
			const local = rotateVector(inverse, d);
			return Navsat.enuGroundToLla(local[0], local[1], this.origin);
		});

		// pick the zoom level for the view scale, backing off until the tile count is sane
		let zoom = zoomForScale(scene.pixelsPerMeter());
		let list = null;
		for (; zoom >= MIN_ZOOM; zoom--) {
			const coords = corners.map((c) => Navsat.coordToTile(c.longitude, c.latitude, zoom));
			const xs = coords.map((c) => c.x), ys = coords.map((c) => c.y);
			const max = (1 << zoom) - 1;
			list = tileList(Math.min(...xs), Math.max(...xs), Math.max(0, Math.min(...ys)), Math.min(max, Math.max(...ys)), MAX_TILES);
			if (list)
				break;
		}
		if (!list)
			return;

		const wanted = new Set();
		for (const tile of list) {
			const key = `${zoom}/${tile.x}/${tile.y}`;
			wanted.add(key);
			this.updateTile(key, tile.x, tile.y, zoom);
		}
		for (const [key, entry] of this.tiles) {
			if (!wanted.has(key)) {
				entry.mesh.removeFromParent();
				entry.mesh.geometry.dispose();
				entry.mesh.material.dispose();
				this.tiles.delete(key);
			}
		}
		// textures of tiles that left the view
		const used = new Set([...this.tiles.values()].map((entry) => entry.source));
		for (const [url, texture] of this.textures) {
			if (!used.has(url)) {
				texture.dispose();
				this.textures.delete(url);
			}
		}
		this.requestRender();
	}

	texture(url) {
		let texture = this.textures.get(url);
		if (!texture) {
			texture = new THREE.Texture(this.navsat.live_cache[url]);
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.generateMipmaps = false;
			texture.needsUpdate = true;
			this.applyFilter(texture);
			this.textures.set(url, texture);
		}
		return texture;
	}

	applyFilter(texture) {
		const filter = this.props.smoothing ? THREE.LinearFilter : THREE.NearestFilter;
		texture.magFilter = filter;
		texture.minFilter = filter;
		texture.needsUpdate = true;
	}

	// finds the image for a tile: its own, or the matching part of a loaded ancestor
	source(x, y, zoom) {
		const cache = this.navsat.live_cache;
		const wrapped = wrapTileX(x, zoom);
		const url = tileUrl(this.props.server_url, zoom, wrapped, y);
		if (cache[url] && cache[url].complete)
			return { url, u0: 0, v0: 0, size: 1, own: true };

		this.navsat.enqueue(url);
		for (let up = 1; up <= 4 && zoom - up >= 0; up++) {
			const crop = parentCrop(wrapped, y, up);
			const parentUrl = tileUrl(this.props.server_url, zoom - up, crop.x, crop.y);
			if (cache[parentUrl] && cache[parentUrl].complete)
				return { url: parentUrl, u0: crop.u0, v0: crop.v0, size: crop.size, own: false };
		}
		return null;
	}

	updateTile(key, x, y, zoom) {
		const entry = this.tiles.get(key);
		if (entry && entry.own)
			return;

		const source = this.source(x, y, zoom);
		if (!source)
			return; // nothing to show yet; it appears when the tile arrives
		if (entry && entry.source === source.url)
			return;

		let mesh = entry?.mesh;
		if (!mesh) {
			const Navsat = this.Navsat;
			// the tile's four corners on the tangent plane: a trapezoid, slightly below it far away
			const corner = (tx, ty) => {
				const c = Navsat.tileToCoord(tx, ty, zoom);
				return Navsat.llaToEnu(c.latitude, c.longitude, undefined, this.origin);
			};
			const nw = corner(x, y), ne = corner(x + 1, y), sw = corner(x, y + 1), se = corner(x + 1, y + 1);
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([
				nw.x, nw.y, nw.z, ne.x, ne.y, ne.z, sw.x, sw.y, sw.z, se.x, se.y, se.z,
			]), 3));
			geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(8), 2));
			geometry.setIndex([0, 2, 1, 1, 2, 3]);
			const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: this.props.opacity, depthWrite: false, side: THREE.DoubleSide,
				polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2 }); // below maps and everything else at z=0
			mesh = new THREE.Mesh(geometry, material);
			mesh.frustumCulled = false;
			mesh.renderOrder = this.order;
			this.holder.add(mesh);
		}

		// image coordinates run down from the top-left; texture v runs up
		const u0 = source.u0, u1 = source.u0 + source.size;
		const v0 = 1 - source.v0, v1 = 1 - (source.v0 + source.size);
		mesh.geometry.attributes.uv.array.set([u0, v0, u1, v0, u0, v1, u1, v1]);
		mesh.geometry.attributes.uv.needsUpdate = true;
		mesh.material.map = this.texture(source.url);
		mesh.material.needsUpdate = true;

		this.tiles.set(key, { mesh, source: source.url, own: source.own });
	}

	clearMeshes() {
		for (const entry of this.tiles.values()) {
			entry.mesh.removeFromParent();
			entry.mesh.geometry.dispose();
			entry.mesh.material.dispose();
		}
		this.tiles.clear();
	}

	clearTiles() {
		this.clearMeshes();
		for (const texture of this.textures.values())
			texture.dispose();
		this.textures.clear();
	}

	onCameraChange() { this.schedule(); }
	onTfChange() { if (this.fix && this.fix.frame !== this.ctx.tf.fixed_frame) this.schedule(); }
	onFixedFrameChange() { this.schedule(); }

	onContextRestored() {
		for (const texture of this.textures.values())
			texture.needsUpdate = true;
	}

	onOverlay(ctx, scene) {
		if (!this.fix || this.props.opacity === 0 || !this.props.server_url.includes("tile.openstreetmap.org"))
			return;
		ctx.globalAlpha = 0.6;
		ctx.fillStyle = "#171717";
		ctx.fillRect(0, scene.height - 20, 120, 20);
		ctx.globalAlpha = 1.0;
		ctx.font = "12px Monospace";
		ctx.textAlign = "left";
		ctx.fillStyle = "white";
		ctx.fillText("© OpenStreetMap", 5, scene.height - 5);
	}

	onPropertyChange(key, value) {
		if (key === "opacity") {
			for (const entry of this.tiles.values())
				entry.mesh.material.opacity = value;
		}
		if (key === "smoothing") {
			for (const texture of this.textures.values())
				this.applyFilter(texture);
		}
		if (key === "server_url") {
			if (this.navsat)
				this.navsat.clear_queue();
			this.clearTiles();
		}
		if (key === "topic") {
			this.fix = null;
			this.anchor = null;
			this.lastFixTime = 0;
			this.clearTiles();
			this.setInfo({});
		}
		this.schedule();
	}

	onDestroy() {
		window.removeEventListener("navsat_tilecache_updated", this.onTiles);
		this.clearTiles();
	}

	buildCustomEditor(container) {
		const heading = document.createElement("h4");
		heading.textContent = "Tile Management";

		const exportButton = document.createElement("button");
		exportButton.className = "export_button";
		exportButton.textContent = "⇑ Export";
		exportButton.addEventListener("click", () => {
			const filename = prompt("Enter file name for tile DB export (.json will be appended automatically):", "navsat_tile_db");
			if (filename != null && this.navsatModule)
				this.navsatModule.exportDatabase(filename + ".json");
		});

		const importButton = document.createElement("button");
		importButton.className = "export_button";
		importButton.textContent = "⇓ Import";
		importButton.addEventListener("click", () => {
			const picker = document.createElement("input");
			picker.type = "file";
			picker.accept = ".json";
			picker.onchange = () => {
				const reader = new FileReader();
				reader.onload = () => {
					try {
						this.navsatModule.importDatabase(reader.result);
					} catch (e) {
						this.status.error("The tile database could not be imported: " + e.message);
					}
				};
				reader.readAsText(picker.files[0]);
			};
			picker.click();
		});

		const note = document.createElement("p");
		note.className = "comment";
		note.textContent = "All fetched tiles are stored in IndexedDB for quick loading and offline use. However, browser-cached data is tied to the site's URL, so if your robot's IP changes (e.g. switching from a local network to offline AP mode), the tiles won't be accessible. To solve this, fetch and export the database while online, and reimport it in offline mode or on other machines.";

		const row = document.createElement("span");
		row.append(exportButton, importButton);
		container.append(heading, row, note);
	}
}
