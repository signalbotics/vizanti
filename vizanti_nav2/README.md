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

## Beyond RViz: Nav2 Tools

Panel *Nav2 Tools* (Main menu → Add panel…) does what a Nav2 user otherwise does from a terminal:

- **Costmaps:** clear the global, the local or both (`/<costmap>/clear_entirely_<costmap>`).
- **Behaviours:** behavior_server's recovery behaviours, each with its settings: Spin (angle),
  Back up and Drive on heading (distance, speed), Wait (time), Assisted teleop (time). It shows
  the progress and how each ended (done, cancelled, or why Nav2 stopped it, e.g. "collision
  ahead"); Cancel stops it. Spin, back up and drive on heading get the panel's time limit (10 s by
  default). Collision checking stays on.
- **Lifecycle nodes:** every lifecycle manager on the graph, the nodes it runs (its
  `node_names`) and each node's state (`get_state`), refreshed every 2 s while the panel is shown.
  A node that does not answer shows "not answering".

Checked live on 2026-11-05 on Jazzy and on Lyrical (`tb3_loopback_simulation`): both costmaps
cleared (Nav2 logged both requests); a 90° spin, a 0.3 m back up and a 0.3 m drive on heading
finished and moved the robot as asked (odometry); a wait was cancelled; pausing navigation from a
terminal showed every node inactive within a few seconds.

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
