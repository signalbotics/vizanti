import * as THREE from '../lib/three.module.min.js';
import { OrbitControls } from '../lib/three_addons/controls/OrbitControls.js';
import { LineSegments2 } from '../lib/three_addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from '../lib/three_addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from '../lib/three_addons/lines/LineMaterial.js';
import { sanitizeCameraState, MIN_ZOOM, MAX_ZOOM } from './camera_state.js';

// ROS is Z-up. This must run before any camera is created.
THREE.Object3D.DEFAULT_UP.set(0, 0, 1);

const TOPDOWN_HEIGHT = 10000;

export function webglSupported() {
	try {
		const canvas = document.createElement("canvas");
		return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
	} catch (e) {
		return false;
	}
}

// One WebGL canvas, two cameras (top-down orthographic and perspective orbit) and a 2D overlay
// canvas for text. Rendering is on demand: nothing is drawn until requestRender() is called.
export class Scene3D {

	constructor(container, frames) {
		this.container = container;
		this.frames = frames;
		this.width = 1;
		this.height = 1;
		this.mode = "topdown";
		this.targetFrame = "";

		this._lastTarget = null;
		this._pending = false;
		this._cameraListeners = [];
		this._restoreListeners = [];
		this._overlayDrawers = [];
		this._lineMaterials = new Set();
		this._v = new THREE.Vector3();
		this._raycaster = new THREE.Raycaster();
		this._ground = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
		this._inputEnabled = true;

		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setPixelRatio(window.devicePixelRatio || 1);
		this.canvas = this.renderer.domElement;
		this.canvas.classList.add("scene_canvas");
		container.appendChild(this.canvas);

		this.overlay = document.createElement("canvas");
		this.overlay.classList.add("scene_overlay");
		container.appendChild(this.overlay);
		this.overlayCtx = this.overlay.getContext("2d");

		this.scene = new THREE.Scene();
		this.scene.add(frames.root);

		// solid shapes (markers) are shaded; flat displays use unlit materials and ignore these
		this.scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.2));
		const sun = new THREE.DirectionalLight(0xffffff, 1.6);
		sun.position.set(3, -5, 10);
		this.scene.add(sun);

		this.persp = new THREE.PerspectiveCamera(50, 1, 0.05, 5000);

		// looks straight down -Z with +Y up on screen, so +X is right like the current 2D view
		this.ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20000);
		this.ortho.up.set(0, 1, 0);

		this.orbitControls = new OrbitControls(this.persp, this.canvas);
		this.orbitControls.minDistance = 0.05;
		this.orbitControls.maxDistance = 4000;
		this.orbitControls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

		this.topControls = new OrbitControls(this.ortho, this.canvas);
		this.topControls.enableRotate = false;
		this.topControls.screenSpacePanning = true;
		this.topControls.zoomToCursor = true;
		this.topControls.minZoom = MIN_ZOOM;
		this.topControls.maxZoom = MAX_ZOOM;
		this.topControls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
		this.topControls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };

		const changed = () => this._cameraChanged();
		this.orbitControls.addEventListener("change", changed);
		this.topControls.addEventListener("change", changed);

		// three.js restores its own GL state; displays get a chance to re-upload what they own
		this.canvas.addEventListener("webglcontextrestored", () => {
			for (const fn of this._restoreListeners)
				fn();
			// the clear colour is GL state, which a restored context does not keep
			if (this._background)
				this.renderer.setClearColor(new THREE.Color(this._background));
			this.requestRender();
		});
		this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());

		this._resizeObserver = new ResizeObserver(() => this.resize());
		this._resizeObserver.observe(container);

		this.setCameraState(null);
		this.resize();
	}

	// ---- listeners ----

	get inputEnabled() { return this._inputEnabled; }

	onCameraChange(fn) { this._cameraListeners.push(fn); }
	onContextRestored(fn) { this._restoreListeners.push(fn); }
	addOverlayDrawer(fn) { this._overlayDrawers.push(fn); }

	removeOverlayDrawer(fn) {
		const index = this._overlayDrawers.indexOf(fn);
		if (index !== -1)
			this._overlayDrawers.splice(index, 1);
	}

	_cameraChanged() {
		this.requestRender();
		for (const fn of this._cameraListeners)
			fn();
	}

	// ---- camera ----

	setCameraState(state) {
		const s = sanitizeCameraState(state);
		this.targetFrame = s.target_frame;
		this.followYaw = s.follow_yaw;
		this._lastTarget = null;
		this._lastYaw = null;

		this.ortho.position.set(s.topdown.x, s.topdown.y, TOPDOWN_HEIGHT);
		this.topControls.target.set(s.topdown.x, s.topdown.y, 0);
		this.ortho.zoom = s.topdown.zoom;
		this.ortho.updateProjectionMatrix();

		this.persp.position.fromArray(s.orbit.position);
		this.orbitControls.target.fromArray(s.orbit.target);

		this.setCameraMode(s.mode);
	}

	getCameraState() {
		return {
			mode: this.mode,
			target_frame: this.targetFrame,
			follow_yaw: this.followYaw,
			topdown: { x: this.topControls.target.x, y: this.topControls.target.y, zoom: this.ortho.zoom },
			orbit: { target: this.orbitControls.target.toArray(), position: this.persp.position.toArray() },
		};
	}

	setCameraMode(mode) {
		this.mode = mode === "orbit" ? "orbit" : "topdown";
		this.camera = this.mode === "orbit" ? this.persp : this.ortho;
		this.orbitControls.enabled = this._inputEnabled && this.mode === "orbit";
		this.topControls.enabled = this._inputEnabled && this.mode === "topdown";
		this.orbitControls.update();
		this.topControls.update();
		this._cameraChanged();
	}

	// Tools that take over the pointer switch camera movement off while they are active.
	setInputEnabled(enabled) {
		this._inputEnabled = !!enabled;
		this.orbitControls.enabled = this._inputEnabled && this.mode === "orbit";
		this.topControls.enabled = this._inputEnabled && this.mode === "topdown";
	}

	setFollowYaw(enabled) {
		this.followYaw = !!enabled;
		this._lastYaw = null;
		this._cameraChanged();
	}

	setTargetFrame(frame) {
		this.targetFrame = frame;
		this._lastTarget = null;
		this._lastYaw = null;
		this._cameraChanged();
	}

	resetCamera() {
		this.setCameraState({ mode: this.mode, target_frame: this.targetFrame });
	}

	// Moves both cameras by however far the target frame moved since the last call.
	followTarget() {
		if (this.targetFrame === "") {
			this._lastTarget = null;
			return;
		}
		const node = this.frames.get(this.targetFrame);
		if (!node)
			return;

		const p = node.position;
		if (this._lastTarget) {
			const dx = p.x - this._lastTarget.x;
			const dy = p.y - this._lastTarget.y;
			const dz = p.z - this._lastTarget.z;
			if (dx !== 0 || dy !== 0 || dz !== 0) {
				this.persp.position.x += dx;
				this.persp.position.y += dy;
				this.persp.position.z += dz;
				this.orbitControls.target.x += dx;
				this.orbitControls.target.y += dy;
				this.orbitControls.target.z += dz;
				this.ortho.position.x += dx;
				this.ortho.position.y += dy;
				this.topControls.target.x += dx;
				this.topControls.target.y += dy;
				this.orbitControls.update();
				this.topControls.update();
				this._cameraChanged();
			}
		}
		this._lastTarget = p.clone();

		// third-person: the orbit camera also swings round as the frame turns
		const yaw = new THREE.Euler().setFromQuaternion(node.quaternion, "ZYX").z;
		if (this.followYaw && this._lastYaw !== null && yaw !== this._lastYaw) {
			const offset = new THREE.Vector3().subVectors(this.persp.position, this.orbitControls.target);
			offset.applyAxisAngle(new THREE.Vector3(0, 0, 1), yaw - this._lastYaw);
			this.persp.position.copy(this.orbitControls.target).add(offset);
			this.orbitControls.update();
			this._cameraChanged();
		}
		this._lastYaw = yaw;
	}

	// ---- size and rendering ----

	resize() {
		const w = this.container.clientWidth;
		const h = this.container.clientHeight;
		if (w <= 0 || h <= 0)
			return; // hidden dock tab or detached container

		this.width = w;
		this.height = h;
		this.renderer.setSize(w, h);

		const pr = this.renderer.getPixelRatio();
		this.overlay.width = Math.round(w * pr);
		this.overlay.height = Math.round(h * pr);
		this.overlay.style.width = w + "px";
		this.overlay.style.height = h + "px";

		this.persp.aspect = w / h;
		this.persp.updateProjectionMatrix();

		this.ortho.left = -w / 2;
		this.ortho.right = w / 2;
		this.ortho.top = h / 2;
		this.ortho.bottom = -h / 2;
		this.ortho.updateProjectionMatrix();

		for (const material of this._lineMaterials)
			material.resolution.set(w, h);

		this._cameraChanged();
	}

	requestRender() {
		if (this._pending)
			return;
		this._pending = true;
		requestAnimationFrame(() => {
			this._pending = false;
			this.renderer.render(this.scene, this.camera);
			this._drawOverlay();
		});
	}

	_drawOverlay() {
		const ctx = this.overlayCtx;
		const pr = this.renderer.getPixelRatio();
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
		ctx.setTransform(pr, 0, 0, pr, 0, 0);
		for (const fn of this._overlayDrawers)
			fn(ctx, this);
	}

	// The view as it is now, with its text overlay, as a canvas ready to save.
	screenshot() {
		this.renderer.render(this.scene, this.camera);
		this._drawOverlay();
		const out = document.createElement("canvas");
		out.width = this.canvas.width;
		out.height = this.canvas.height;
		const ctx = out.getContext("2d");
		ctx.drawImage(this.canvas, 0, 0);
		ctx.drawImage(this.overlay, 0, 0, out.width, out.height);
		return out;
	}

	setBackground(hex) {
		this._background = hex;
		this.renderer.setClearColor(new THREE.Color(hex));
		this.requestRender();
	}

	// ---- measurement ----

	// CSS pixels per metre at the point the camera looks at
	pixelsPerMeter() {
		if (this.mode === "topdown")
			return this.ortho.zoom;
		const distance = this.persp.position.distanceTo(this.orbitControls.target);
		return this.height / (2 * distance * Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2));
	}

	viewTarget() {
		return (this.mode === "topdown" ? this.topControls.target : this.orbitControls.target).clone();
	}

	// how far around viewTarget() ground-plane content needs to extend to fill the view
	viewRadiusMeters() {
		if (this.mode === "topdown")
			return Math.hypot(this.width, this.height) / (2 * this.ortho.zoom);
		return this.persp.position.distanceTo(this.orbitControls.target) * 2;
	}

	// PointsMaterial settings that draw a point `meters` wide.
	// Orthographic cameras ignore size attenuation, so the size is given in pixels there.
	pointSize(meters) {
		if (this.mode === "topdown")
			return { size: Math.max(1, meters * this.ortho.zoom), sizeAttenuation: false };
		return { size: meters / Math.tan(THREE.MathUtils.degToRad(this.persp.fov) / 2), sizeAttenuation: true };
	}

	// fixed-frame point -> CSS pixel position on the canvas
	project(x, y, z) {
		const v = this._v.set(x, y, z).project(this.camera);
		return {
			x: (v.x + 1) / 2 * this.width,
			y: (1 - v.y) / 2 * this.height,
			visible: v.z > -1 && v.z < 1,
		};
	}

	// window (client) coordinates -> point on the fixed frame's z = 0 plane, or null when the
	// view ray does not reach it
	groundPoint(clientX, clientY) {
		const rect = this.container.getBoundingClientRect();
		const ndc = new THREE.Vector2(
			((clientX - rect.left) / this.width) * 2 - 1,
			-((clientY - rect.top) / this.height) * 2 + 1
		);
		this.camera.updateMatrixWorld();
		this._raycaster.setFromCamera(ndc, this.camera);
		const hit = this._raycaster.ray.intersectPlane(this._ground, new THREE.Vector3());
		return hit ? { x: hit.x, y: hit.y, z: 0 } : null;
	}

	// The nearest thing under the pointer: a point on a solid object or point cloud, or else
	// the ground plane. Lines and hidden objects are ignored. Returns { x, y, z } or null.
	pick(clientX, clientY) {
		const hit = this.pickObject(clientX, clientY);
		const ground = this._raycaster.ray.intersectPlane(this._ground, new THREE.Vector3());
		const best = ground && (!hit || this._raycaster.ray.origin.distanceTo(ground) < hit.distance) ? ground : hit?.point;
		return best ? { x: best.x, y: best.y, z: best.z } : null;
	}

	// The nearest visible mesh or point under the pointer, as { object, point, index, distance }
	// (index: which point of a point cloud), or null. Leaves the ray in this._raycaster.
	pickObject(clientX, clientY) {
		const rect = this.container.getBoundingClientRect();
		const ndc = new THREE.Vector2(
			((clientX - rect.left) / this.width) * 2 - 1,
			-((clientY - rect.top) / this.height) * 2 + 1
		);
		this.camera.updateMatrixWorld();
		this._raycaster.setFromCamera(ndc, this.camera);
		this._raycaster.params.Points.threshold = 4 / this.pixelsPerMeter(); // about 4 px

		const shown = (object) => {
			for (let o = object; o; o = o.parent) {
				if (!o.visible)
					return false;
			}
			return true;
		};

		let hits = [];
		try {
			hits = this._raycaster.intersectObject(this.frames.root, true);
		} catch (e) {
			// a geometry that cannot be ray-tested must not break the tools
		}
		for (const hit of hits) {
			const o = hit.object;
			if (o.isLineSegments2 || !(o.isMesh || o.isPoints) || !shown(o))
				continue;
			// hits are sorted nearest first
			return { object: o, point: hit.point.clone(), index: hit.index, distance: hit.distance };
		}
		return null;
	}

	// the pointer's ray in the fixed frame, as THREE vectors
	ray(clientX, clientY) {
		const rect = this.container.getBoundingClientRect();
		const ndc = new THREE.Vector2(
			((clientX - rect.left) / this.width) * 2 - 1,
			-((clientY - rect.top) / this.height) * 2 + 1
		);
		this.camera.updateMatrixWorld();
		this._raycaster.setFromCamera(ndc, this.camera);
		return { origin: this._raycaster.ray.origin.clone(), direction: this._raycaster.ray.direction.clone() };
	}

	// The nearest visible solid object under the pointer that carries userData.interactive,
	// as { object, point, interactive }, or null.
	pickInteractive(clientX, clientY) {
		const ray = this.ray(clientX, clientY);
		this._raycaster.set(ray.origin, ray.direction);
		let hits = [];
		try {
			hits = this._raycaster.intersectObject(this.frames.root, true);
		} catch (e) {
			return null;
		}
		for (const hit of hits) {
			const o = hit.object;
			if (!o.isMesh || o.isLineSegments2)
				continue;
			let visible = true;
			for (let p = o; p; p = p.parent) {
				if (!p.visible)
					visible = false;
			}
			if (!visible)
				continue;
			// the first solid thing in the way decides: an ordinary object blocks what is behind it
			return o.userData.interactive ? { object: o, point: hit.point, interactive: o.userData.interactive } : null;
		}
		return null;
	}

	// moves the camera so it looks at a point, keeping its distance and direction
	focusOn(point) {
		const orbit = this.orbitControls.target;
		const dx = point.x - orbit.x, dy = point.y - orbit.y, dz = point.z - orbit.z;
		this.persp.position.x += dx;
		this.persp.position.y += dy;
		this.persp.position.z += dz;
		orbit.set(point.x, point.y, point.z);

		this.ortho.position.x = point.x;
		this.ortho.position.y = point.y;
		this.topControls.target.set(point.x, point.y, 0);

		this.orbitControls.update();
		this.topControls.update();
		this._cameraChanged();
	}

	// ---- fat lines (WebGL lines are always 1px wide) ----

	// linewidth is in pixels, or in metres when worldUnits is set
	makeLines({ color = "#ffffff", linewidth = 1, opacity = 1, vertexColors = false, worldUnits = false } = {}) {
		const material = new LineMaterial({
			color,
			linewidth,
			opacity,
			vertexColors,
			worldUnits,
			transparent: true,
			depthWrite: false,
		});
		material.resolution.set(this.width, this.height);
		this._lineMaterials.add(material);

		const lines = new LineSegments2(new LineSegmentsGeometry(), material);
		lines.frustumCulled = false;
		lines.visible = false;
		return lines;
	}

	// positions: Float32Array of segment endpoints (x,y,z, x,y,z per segment).
	// Returns true when there is something to draw.
	setLinePositions(lines, positions, colors) {
		lines.geometry.dispose();
		lines.geometry = new LineSegmentsGeometry();
		if (positions.length === 0) {
			lines.visible = false;
			return false;
		}
		lines.geometry.setPositions(positions);
		if (colors)
			lines.geometry.setColors(colors);
		lines.visible = true;
		return true;
	}

	disposeLines(lines) {
		this._lineMaterials.delete(lines.material);
		lines.geometry.dispose();
		lines.material.dispose();
	}
}
