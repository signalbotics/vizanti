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

## Differences from RViz

- Actions and services go through rosbridge. Vizanti's rosbridge waits 5 s for an action
  server (rosbridge's own 1 s is too short for Nav2), and service calls pass their timeout on.
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
