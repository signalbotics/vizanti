// Label, icon, description and accepted message types for every widget that still runs
// from its original template. Extracted from the old add dialog.
export const CATALOG = {
	"grid": {
		"label": "Grid",
		"icon": "assets/grid.svg",
		"description": "Infinite grid centered at the origin of the target frame of reference",
		"msgTypes": []
	},
	"tf": {
		"label": "TF",
		"icon": "assets/tf.svg",
		"description": "TF transform hierarchy",
		"msgTypes": []
	},
	"robotmodel": {
		"label": "Robot Model",
		"icon": "assets/robotmodel.svg",
		"description": "Custom robot sprite",
		"msgTypes": []
	},
	"reconfigure": {
		"label": "Parameter Reconfigure",
		"icon": "assets/reconfigure.svg",
		"description": "View and edit parameters",
		"msgTypes": []
	},
	"rosbag": {
		"label": "Bag Recorder",
		"icon": "assets/rosbag.svg",
		"description": "Record rosbags",
		"msgTypes": []
	},
	"nodemgr": {
		"label": "Node Manager",
		"icon": "assets/nodemgr.svg",
		"description": "Start and stop nodes",
		"msgTypes": []
	},
	"folder": {
		"label": "Folder",
		"icon": "assets/folder.svg",
		"description": "Group your widgets together",
		"msgTypes": []
	},
	"inspector": {
		"label": "Topic Inspector",
		"icon": "assets/inspector.svg",
		"description": "View raw messages as text",
		"msgTypes": []
	},
	"diagnostics": {
		"label": "Diagnostics",
		"icon": "assets/diagnostics.svg",
		"description": "Monitor [diagnostic_msgs/DiagnosticArray] or [rcl_interfaces/Log]",
		"msgTypes": [
			"diagnostic_msgs/msg/DiagnosticArray",
			"rcl_interfaces/msg/Log"
		]
	},
	"teleop": {
		"label": "Teleop Joystick",
		"icon": "assets/joystick.svg",
		"description": "Send velocity with [geometry_msgs/Twist] or [geometry_msgs/TwistStamped]",
		"msgTypes": [
			"geometry_msgs/msg/Twist",
			"geometry_msgs/msg/TwistStamped"
		]
	},
	"odom": {
		"label": "Pose Tracker",
		"icon": "assets/odom.svg",
		"description": "Track a TF link or [nav_msgs/Odometry] data over time.",
		"msgTypes": [
			"nav_msgs/msg/Odometry"
		]
	},
	"map": {
		"label": "Map",
		"icon": "assets/map.svg",
		"description": "nav_msgs/OccupancyGrid",
		"msgTypes": [
			"nav_msgs/msg/OccupancyGrid"
		]
	},
	"satelite": {
		"label": "Satellite Tiles",
		"icon": "assets/satelite.svg",
		"description": "sensor_msgs/NavSatFix",
		"msgTypes": [
			"sensor_msgs/msg/NavSatFix"
		]
	},
	"gridcells": {
		"label": "Grid Cells",
		"icon": "assets/gridcells.svg",
		"description": "nav_msgs/GridCells",
		"msgTypes": [
			"nav_msgs/msg/GridCells"
		]
	},
	"compressedimage": {
		"label": "Compressed Image",
		"icon": "assets/image.svg",
		"description": "sensor_msgs/CompressedImage",
		"msgTypes": [
			"sensor_msgs/msg/CompressedImage"
		]
	},
	"markerarray": {
		"label": "Marker Array",
		"icon": "assets/markerarray.svg",
		"description": "visualization_msgs/MarkerArray",
		"msgTypes": [
			"visualization_msgs/msg/MarkerArray"
		]
	},
	"scan": {
		"label": "Laser Scan",
		"icon": "assets/scan.svg",
		"description": "sensor_msgs/LaserScan",
		"msgTypes": [
			"sensor_msgs/msg/LaserScan"
		]
	},
	"pointcloud": {
		"label": "Point Cloud",
		"icon": "assets/pointcloud.svg",
		"description": "sensor_msgs/PointCloud2",
		"msgTypes": [
			"sensor_msgs/msg/PointCloud2"
		]
	},
	"path": {
		"label": "Path",
		"icon": "assets/path.svg",
		"description": "nav_msgs/Path",
		"msgTypes": [
			"nav_msgs/msg/Path"
		]
	},
	"posewithcovariancestamped": {
		"label": "Pose",
		"icon": "assets/posewithcovariancestamped.svg",
		"description": "geometry_msgs/PoseWithCovarianceStamped, geometry_msgs/PoseStamped",
		"msgTypes": [
			"geometry_msgs/msg/PoseWithCovarianceStamped",
			"geometry_msgs/msg/PoseStamped"
		]
	},
	"posearray": {
		"label": "Pose Array",
		"icon": "assets/posearray.svg",
		"description": "geometry_msgs/PoseArray, nav2_msgs/ParticleCloud",
		"msgTypes": [
			"geometry_msgs/msg/PoseArray",
			"nav2_msgs/msg/ParticleCloud"
		]
	},
	"range": {
		"label": "Range",
		"icon": "assets/range.svg",
		"description": "sensor_msgs/Range",
		"msgTypes": [
			"sensor_msgs/msg/Range"
		]
	},
};
