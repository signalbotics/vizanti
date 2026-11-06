# vizanti_nav2

Vizanti versions of every class in Nav2's `nav2_rviz_plugins`, as Vizanti plugins (see
`docs/plugins.md`). Each one claims its RViz class, so an `.rviz` config that uses the Nav2
plugins opens in Vizanti with these in their place.

| RViz class | Vizanti | Where | What it does |
|---|---|---|---|
| `nav2_rviz_plugins/Navigation 2` | panel *Navigation 2* | Main menu → Add panel… | Startup / pause / reset of the Nav2 lifecycle nodes; NavigateToPose; waypoint following and NavigateThroughPoses (with loops); live feedback; save/load waypoints as YAML |
| `nav2_rviz_plugins/GoalTool` | tool *Nav2 Goal* | toolbar "+" | Press and drag a goal. Goes to an open Navigation 2 panel (in waypoint mode it adds a waypoint), otherwise straight to NavigateToPose |
| `nav2_rviz_plugins/Selector` | panel *Selector* | Add panel… | Picks the controller, planner, goal checker, smoother, progress checker and path handler (lists read from the servers' parameters; choices published on `/<name>_selector`) |
| `nav2_rviz_plugins/Docking` | panel *Docking* | Add panel… | DockRobot / UndockRobot by dock id or by dock pose and type, with cancel, state, time, retries and the error reason |
| `nav2_rviz_plugins/CostmapCostTool` | tool *Costmap Cost* | toolbar "+" | Click a point: its local and global costmap cost (RViz prints it to its log; here it is a notification) |
| `nav2_rviz_plugins/ParticleCloud` | display *ParticleCloud* | Add display | `nav2_msgs/ParticleCloud` as flat arrows, 3D arrows or axes, arrow length from the particle weight |
| `nav2_rviz_plugins/Route Tool` | panel *Route Tool* | Add panel… | Builds and edits a Nav2 route graph: add / edit / remove nodes and edges, load and save nav2_route GeoJSON, graph drawn on `/route_graph` (add a MarkerArray display for it). Publish Point fills X / Y |

## Nav2 versions

One Vizanti works with the Nav2 of Humble, Jazzy and later releases (`vizanti/nav2_compat.js`).
Where Nav2's interfaces differ, Vizanti asks the robot (rosapi) which one it has:

| | Humble, Jazzy | Kilted and later (Lyrical) |
|---|---|---|
| NavigateThroughPoses goal | `poses: PoseStamped[]` | `poses: nav_msgs/Goals` |
| Costmap cost service | `GetCost` (x, y in the costmap's frame) | `GetCosts` (stamped poses) |
| Lifecycle managers | `lifecycle_manager_navigation` and `lifecycle_manager_localization` | `lifecycle_manager_nav2` |
| Selector's Path Handler | none (the drop-down is hidden) | yes |
| Position / heading tracking error in the feedback | none (the rows are hidden) | yes |

The Navigation 2 panel's "Lifecycle manager" setting is empty by default: it finds the managers
itself. With two (Humble, Jazzy) it shows a Localization row and sends Startup, Pause, Resume and
Reset to both, as the Jazzy panel does.

## Nav2 namespaces and names

Nothing is tied to one robot's names. Every panel (Navigation 2, Selector, Docking, Route Tool,
Nav2 Tools) has a **Nav2 namespace** setting: for Nav2 launched with `namespace:=robot1`, set
`robot1` and every action, service and topic is looked up under `/robot1`. What can be found on
the graph is found, not assumed:
- lifecycle managers (`ManageLifecycleNodes` services) and the nodes they run (`node_names`);
- costmaps, by their service type (`ClearEntireCostmap`, `GetCost` / `GetCosts`), under any name;
- the map saver (`SaveMap`); Nav2's interface versions (rosapi); the Collision Monitor's zones,
  frame and state topic (its parameters).

The rest are Nav2's standard names (`spin`, `compute_path_to_pose`, `navigate_to_pose`, ...), in
the namespace. The Nav2 Goal tool sends to an open Navigation 2 panel; with none open, to
`/navigate_to_pose`. Publish Point's `/clicked_point` fills the X / Y fields, as in RViz.

Checked on Jazzy with Nav2 under `robot1`: the panels found `robot1/lifecycle_manager_navigation`
(and left out the root map server's), started navigation, cleared both `/robot1` costmaps, and
their goals reached `robot1.behavior_server` and `robot1.planner_server` (Nav2's log). Nav2's own
loopback simulation launch is only half namespaced (the simulator, map server and `/tf` stay at
the root), so driving there was not checked.

## Beyond RViz: Nav2 Tools

Panel *Nav2 Tools* (Main menu → Add panel…) does what a Nav2 user otherwise does from a terminal:

- **Costmaps:** one button per costmap found, and Clear all.
- **Behaviours:** behavior_server's recovery behaviours, each with its settings: Spin (angle),
  Back up and Drive on heading (distance, speed), Wait (time), Assisted teleop (time). It shows
  the progress and how each ended (done, cancelled, or why Nav2 stopped it, e.g. "collision
  ahead"); Cancel stops it. Spin, back up and drive on heading get the panel's time limit (10 s by
  default). Collision checking stays on.
- **Plan:** a path from the robot to a goal (ComputePathToPose; Publish Point fills X and Y, a
  planner can be named), its length and pose count, published on `/nav2_tools/plan` (add a Path
  display). The robot does not move. **Drive plan** follows it (FollowPath); Cancel stops it.
- **Map:** save the map on the robot (SaveMap: path, pgm / png / bmp, trinary / scale / raw, map
  topic). The map saver runs with SLAM; without one the panel says how to start it.
- **Lifecycle nodes:** every lifecycle manager on the graph, the nodes it runs (its
  `node_names`) and each node's state (`get_state`), refreshed every 2 s while the panel is shown.
  A node that does not answer shows "not answering".

Checked live on 2026-11-05 on Jazzy and on Lyrical (`tb3_loopback_simulation`): both costmaps
cleared (Nav2 logged both requests); a 90° spin, a 0.3 m back up and a 0.3 m drive on heading
finished and moved the robot as asked (odometry); a wait was cancelled; pausing navigation from a
terminal showed every node inactive within a few seconds.

Plan and Map were checked live on 2026-11-06 on Jazzy and Lyrical: a 1.02 m plan was published
and driven ("Arrived"); a goal outside the map was refused in words; without a map saver the panel
said so; with one started, the map was saved (a 147 KB .pgm and its .yaml).

## Beyond RViz: Collision Monitor display

Display *Collision Monitor* (Add display) draws Nav2's collision_monitor zones around the robot,
coloured by action (stop red, slow down orange, approach yellow, limit blue), and fills the one
that is acting (`collision_monitor_state`, or the node's `state_topic`). The shapes come from the
node's parameters (polygon points, circle radius), so they show although nav2_bringup has
`visualize: false`; a zone that follows the footprint is drawn from its footprint topic, a
velocity polygon only from its published outline (`visualize: true`). A parameter the node
declares without a value (`FootprintApproach.points`) makes ROS answer nothing for the whole
request, so the parameters are read one by one when that happens.

Checked live on 2026-11-06 on Jazzy with a stop polygon, a slow-down circle and the footprint
approach zone: all three drawn; driving into obstacles, "Slow down: SlowCircle" and then "Stop:
PolygonStop" (as Nav2 logged) filled the acting zone. On Lyrical and Jazzy with nav2_bringup's
defaults: the footprint approach zone.

## Beyond RViz: keepout and speed zones

Panel *Costmap Zones* (Add panel…) draws zones for Nav2's costmap filters:

- It finds the filters on the graph (their `nav2_msgs/CostmapFilterInfo` topics, from
  `costmap_filter_info_server`): keepout, speed limit in % or m/s, binary.
- Click a zone's corners with Publish Point, then **Finish zone**. A speed zone takes its limit;
  the mask value is worked out from the filter's base and multiplier (limit = base + multiplier
  × value).
- The zones go into the mask the filter uses now (from its mask server or published earlier), or
  into an empty mask the size of the map when there is none. "Keep the zones already in the mask"
  can be turned off.
- **Publish mask** sends it to the filter's mask topic, latched: the costmap uses it at once.
  **Save .pgm + .yaml** downloads it as map_server loads a mask (`mode: raw`), for the filter's
  mask server (`yaml_filename`) on the robot.
- The zones being drawn are on `/costmap_zones/markers` (a MarkerArray display); the mask on the
  filter's topic (a Map display).

Checked live on 2026-11-06 on Jazzy with a keepout and a speed filter (costmap_filter_info_server,
filters in the global costmap, no mask server): a keepout square made the global costmap's cost
there 254 (147 next to it, unchanged), and removing it brought 147 back; a 40 % zone around the
robot made the speed filter publish `/speed_limit` 40 % (0, no limit, before); the saved .pgm was
384 × 384 with the zone's 144 cells at 60 (100 − 40).

## Beyond RViz: routes

Route Tool's **Route** tab asks Nav2's route server for a route over the graph *it* has loaded
(the launch file's `graph`, or one set with `/route_server/set_route_graph`), not the graph being
edited in the panel:

- **From** two node ids, or **from the robot** to a point (Publish Point fills X and Y).
- **Compute** shows the route's nodes, cost and length, and publishes its path on
  `/route_tool/path` (add a Path display to see it). The robot does not move.
- **Drive** computes the route and drives through its nodes with NavigateThroughPoses, so Nav2's
  planner first brings the robot onto the route; **Cancel** stops it. (Handing the route's path
  straight to the controller with FollowPath failed when the robot was not at the first node, and
  Jazzy has no route behaviour tree.) Edge operations and speed limits of the graph are not
  applied this way.
- Why a route was refused is said in words; Nav2's "unordered_map::at" means a node id is not in
  the graph.

Checked live on 2026-11-06:
- Lyrical, `turtlebot3_graph` (the launch default): route 4 → 7 → 8 computed and published; an
  unknown id explained; a drive from the robot to (0.6, −0.6) went 8 → 9 → 10 → 6 and arrived; a
  second drive was cancelled and the robot stopped.
- Jazzy: `turtlebot3_graph` does not fit the map Jazzy's loopback simulation loads (its route
  server rejects most routes, and Nav2 could not drive the one it gave). With a graph made in
  Route Tool along free space, drives by node ids and from the robot to a point arrived.

## Differences from RViz

- Actions and services go through rosbridge. Vizanti's rosbridge waits 5 s for an action
  server (rosbridge's own 1 s is too short for Nav2), and service calls pass their timeout on.
- Vizanti's rosbridge keeps one client per service instead of making a new one for every call.
  A client that is moments old can have its request dropped before DDS has matched it to the
  server; on Jazzy every other Pause / Resume never reached Nav2's lifecycle manager.
- Costmap Cost on Humble / Jazzy transforms the point into each costmap's frame (`odom` for the
  local one); the RViz tool sends the fixed-frame x, y to both.
- Costmap Cost asks for the point at the latest transform (stamp 0): the browser's clock is not
  the robot's (simulation time), and a future stamp makes Nav2 answer `success: false`. A point
  outside a costmap reads "no cost here" instead of a meaningless number.
- Route Tool: removing a node also removes the edges that start at it (RViz kept them and saved
  them with a dangling start id), and removed nodes and edges disappear from the view.
- Waypoint and route graph files are opened and saved through the browser.

## Tests

`node --test "vizanti_nav2/test/*.test.mjs"` (from the repository root; CI runs it). Each panel's
behaviour lives in a `*_logic.js` module next to it so it can be tested without a browser.

Checked live on 2026-10-28 against Nav2 on Lyrical (`nav2_bringup tb3_loopback_simulation_launch.py`):
startup, NavigateToPose and waypoint following reached their goals; Selector read the real
plugin lists and published the choice; Docking reported Nav2's errors and cancelled; Costmap
Cost read real costs; ParticleCloud drew all three shapes; a graph saved from Route Tool was
accepted by Nav2's route server (`/route_server/set_route_graph`). The live setup is in
`vizanti_server/test/e2e/run_server_docker.sh` (set `IMAGE` to an image with Nav2).

Checked live on 2026-11-05 against Nav2 1.3.13 on Jazzy (`tb3_loopback_simulation.launch.py`), and
again on Lyrical with the same changes:
- the Navigation 2 panel found the lifecycle manager by itself; NavigateToPose, waypoint
  following and NavigateThroughPoses reached their goals; live feedback; Cancel showed
  "canceled"; Pause and Resume, three times each, reached Nav2;
- Selector loaded its lists (no Path Handler on Jazzy) and its choice reached the bt_navigator;
- Docking reported "dock not in database"; Costmap Cost read costs inside and outside each
  costmap; ParticleCloud drew a published cloud; Route Tool's graph was accepted by the route
  server.

Not checked live: Humble (its forms are the Jazzy ones above, covered by the unit tests only),
the Nav2 Goal tool by pointer (it sends the same NavigateToPose goal), and the touch UI.
