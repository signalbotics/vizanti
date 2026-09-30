import * as THREE from '../lib/three.module.min.js';
import { Display } from '../core/display.js';

const CATEGORIES = ["ground", "sea", "air", "misc"];

// file name -> the name shown in the gallery and stored in the layout
function spriteName(file) {
	return file.split(".png")[0].split("_").join(" ").trim();
}

// A flat sprite of the robot, drawn to scale at a TF frame.
export class RobotModelDisplay extends Display {

	static type = "robotmodel";
	static label = "Robot Model";
	static icon = "assets/robotmodel.svg";
	static description = "Custom robot sprite";

	static properties = {
		frame: { type: "frame", label: "TF Frame", noDefault: true, help: "Renders a simple 2D sprite of a fixed size relative to a TF link, for scale." },
		length: { type: "float", label: "Robot Length (m)", default: 0.5, min: 0.01, step: 0.01 },
		offset_x: { type: "float", label: "X offset (m)", default: 0, step: 0.01 },
		offset_y: { type: "float", label: "Y offset (m)", default: 0, step: 0.01 },
		offset_yaw: { type: "float", label: "Yaw offset (deg)", default: 0, min: -180, max: 180, step: 0.01 },
		opacity: { type: "float", label: "Opacity", default: 1.0, min: 0.1, max: 1, step: 0.05, slider: true },
		sprite: { type: "string", hidden: true, default: "4wd" },
	};

	get iconColor() {
		return null;
	}

	onCreate() {
		this.material = new THREE.MeshBasicMaterial({ transparent: true, opacity: this.props.opacity, depthWrite: false, side: THREE.DoubleSide });
		this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
		this.mesh.visible = false;
		this.add(this.mesh);
		this.ratio = 1;
		this.sprites = null; // name -> url
		this.editor = null;

		if (this.props.frame === "")
			this.props.frame = this.guessFrame();

		this.loadSprites().then(() => this.applySprite());
		this.place();
	}

	// the first frame that looks like a robot base
	guessFrame() {
		const frames = [...this.ctx.tf.frame_list];
		for (const wanted of ["base_link", "base_footprint", "base"]) {
			const found = frames.find((frame) => frame.includes(wanted));
			if (found)
				return found;
		}
		return "base_link";
	}

	async loadSprites() {
		const paths = (await import(`${base_url}/assets/robot_model/paths`)).default;
		this.sprites = {};
		this.categories = {};
		for (const category of Object.keys(paths)) {
			this.categories[category] = [];
			for (const file of paths[category]) {
				const name = spriteName(file);
				this.categories[category].push(name);
				this.sprites[name] ??= category === "misc"
					? `${base_url}/assets/robot_model/${file}`
					: `${base_url}/assets/robot_model/${category}/${file}`;
			}
		}
		if (this.editor)
			this.editor.render();
	}

	applySprite() {
		const url = this.sprites?.[this.props.sprite];
		if (!url) {
			this.mesh.visible = false;
			this.status.error("Required robot sprite not found..?");
			return;
		}
		new THREE.TextureLoader().load(url, (texture) => {
			if (!this._alive)
				return;
			texture.colorSpace = THREE.SRGBColorSpace;
			if (this.material.map)
				this.material.map.dispose();
			this.material.map = texture;
			this.material.needsUpdate = true;
			this.ratio = texture.image.naturalHeight / texture.image.naturalWidth;
			this.applyShape();
			this.place();
			this.requestRender();
		});
	}

	applyShape() {
		this.mesh.scale.set(this.props.length, this.props.length * this.ratio, 1);
		this.mesh.position.set(this.props.offset_x, this.props.offset_y, 0);
		// the sprites are drawn facing left
		this.mesh.rotation.z = THREE.MathUtils.degToRad(this.props.offset_yaw) + Math.PI;
	}

	place() {
		const node = this.ctx.frames.get(this.props.frame);
		if (!node) {
			this.mesh.visible = false;
			this.status.error(`Required transform frame "${this.props.frame}" not found.`);
			return;
		}
		if (this.root.parent !== node)
			node.add(this.root);
		if (this.material.map) {
			this.mesh.visible = true;
			this.status.ok();
		}
	}

	onTfChange() {
		if (!this.mesh.visible)
			this.place();
	}

	onFixedFrameChange() {
		this.place();
	}

	onPropertyChange(key, value) {
		if (key === "opacity")
			this.material.opacity = value;
		if (key === "sprite")
			this.applySprite();
		if (key === "frame")
			this.place();
		this.applyShape();
	}

	onDestroy() {
		if (this.material.map)
			this.material.map.dispose();
		this.mesh.geometry.dispose();
		this.material.dispose();
	}

	// ---- sprite gallery ----

	buildCustomEditor(container) {
		const tabs = document.createElement("div");
		tabs.className = "tab";
		const gallery = document.createElement("div");
		gallery.className = "thumbnail-gallery";
		let active = "ground";

		const render = () => {
			tabs.replaceChildren();
			for (const category of CATEGORIES) {
				const tab = document.createElement("button");
				tab.className = "tablinks" + (category === active ? " active-tab" : "");
				tab.textContent = category[0].toUpperCase() + category.slice(1);
				tab.addEventListener("click", () => { active = category; render(); });
				tabs.appendChild(tab);
			}

			gallery.replaceChildren();
			for (const name of [...(this.categories?.[active] ?? [])].sort()) {
				const item = document.createElement("div");
				item.className = "thumbnail-item" + (name === this.props.sprite ? " selected" : "");
				const image = document.createElement("img");
				image.src = this.sprites[name];
				image.alt = name;
				const label = document.createElement("span");
				label.className = "thumb-label";
				label.textContent = name;
				item.append(image, label);
				item.addEventListener("click", () => {
					this.setProp("sprite", name);
					render();
				});
				gallery.appendChild(item);
			}
		};

		// open on the tab that holds the current sprite
		for (const category of CATEGORIES) {
			if (this.categories?.[category]?.includes(this.props.sprite))
				active = category;
		}

		const note = document.createElement("p");
		note.className = "comment";
		note.textContent = "The sprites are sourced from vizanti/vizanti_server/public/assets/robot_model/ and should start with an underscore, must be in .png format and will rotate around the image center.";

		container.append(tabs, gallery, note);
		render();
		this.editor = { render };
	}
}
