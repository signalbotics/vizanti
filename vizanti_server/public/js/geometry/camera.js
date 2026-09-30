// intrinsics from a sensor_msgs/CameraInfo (ROS 2 uses k, ROS 1 used K)
export function intrinsics(info) {
	const k = info?.k ?? info?.K;
	if (!k || k.length < 9)
		return null;
	const [fx, , cx, , fy, cy] = [k[0], k[1], k[2], k[3], k[4], k[5]];
	return { fx, fy, cx, cy };
}

export function cameraInfoValid(info) {
	const i = intrinsics(info);
	return !!i && info.width > 0 && info.height > 0 && i.fx > 0 && i.fy > 0 && Number.isFinite(i.cx) && Number.isFinite(i.cy);
}

// The four corners of the image plane `distance` metres in front of the camera, in the
// optical frame (z forward, x right, y down).
export function frustumCorners(info, distance) {
	const { fx, fy, cx, cy } = intrinsics(info);
	const at = (u, v) => ({ x: ((u - cx) / fx) * distance, y: ((v - cy) / fy) * distance, z: distance });
	return {
		topLeft: at(0, 0),
		topRight: at(info.width, 0),
		bottomLeft: at(0, info.height),
		bottomRight: at(info.width, info.height),
	};
}
