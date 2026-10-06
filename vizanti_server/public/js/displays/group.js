import { Display } from '../core/display.js';

// A group of displays, as in RViz: one switch shows or hides all of them. The RViz UI nests them
// under it in the Displays list; the touch UI shows it as a folder in the icon bar. Its type stays
// "folder", the name the touch UI's folders were saved with.
export class GroupDisplay extends Display {

	static type = "folder";
	static label = "Group";
	static icon = "assets/folder.svg";
	static description = "A group of displays with one switch for all of them (a folder in the touch UI)";
	static category = "Scene";
	static isGroup = true;
	static properties = {};

	get iconColor() {
		return null;
	}
}
