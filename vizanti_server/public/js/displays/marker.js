import { MarkerArrayDisplay } from './markerarray.js';

// A topic of single visualization_msgs/Marker messages; drawn exactly like a marker array.
export class MarkerDisplay extends MarkerArrayDisplay {

	static type = "marker";
	static label = "Marker";
	static icon = "assets/marker.svg";
	static description = "visualization_msgs/Marker";
	static msgTypes = ["visualization_msgs/msg/Marker"];

	onMessage(msg) {
		super.onMessage({ markers: [msg] });
	}
}
