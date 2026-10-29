# vizanti_moveit

Vizanti versions of MoveIt's RViz displays (`moveit_ros_visualization`), as Vizanti plugins (see
`docs/plugins.md`). Each one claims its RViz class, so an `.rviz` config that uses them opens in
Vizanti with these in their place.

| RViz class | Vizanti display | What it shows / does |
|---|---|---|
| `moveit_rviz_plugin/RobotState` | *RobotState* | The robot in the state a `moveit_msgs/DisplayRobotState` gives (`/display_robot_state`), with highlighted links, `hide` |
| `moveit_rviz_plugin/Trajectory` | *Trajectory* | Animates planned paths (`/display_planned_path`): State Display Time (3x… or 0.1s…), loop, trail, interrupt, robot colour |
| `moveit_rviz_plugin/PlanningScene` | *PlanningScene* | MoveIt's world: collision objects (boxes, spheres, cylinders, cones, meshes, planes) with their colours, and the scene robot with its attached objects. Asks `get_planning_scene` for the whole scene first, then follows `/monitored_planning_scene` |
| `moveit_rviz_plugin/MotionPlanning` | *MotionPlanning* | All of PlanningScene, plus the query start and goal states, a 6-DOF handle on the goal's end effector (drag it, or grab the end effector itself; solved with `/compute_ik` as you drag), and a Motion Planning section in the display's settings: planning group, start and goal states (current or the SRDF's named states), velocity / acceleration scaling, planning time and attempts, Plan / Execute / Plan & Execute / Stop (`/move_action`, `/execute_trajectory`), goal joint sliders, and the planned path |

All of them read the URDF from `/robot_description` (and MotionPlanning the SRDF from
`/robot_description_semantic`), the topics move_group's launch publishes, and draw the robot from
joint values with forward kinematics, at the root link's place in the fixed frame.

## Differences from RViz

- The Motion Planning controls are a section of the display's settings (in the Displays panel),
  not a separate dock.
- Planning uses joint goals from the goal state (what RViz sends too) and the current state as
  the start unless a named start state is chosen. Not yet ported: the Scene Objects, Stored
  Scenes / States and Manipulation tabs, path constraints, workspace bounds, the trajectory slider.
- The end-effector handle uses Vizanti's interactive marker handles; there is no per-joint
  marker (use the joint sliders).

## Tests

`node --test "vizanti_moveit/test/*.test.mjs"` (from the repository root; CI runs it). The SRDF,
group and request logic is tested on MoveIt's own Panda description (`test/fixtures`).

Checked live on 2026-10-29 against MoveIt's Panda demo (`moveit_resources_panda_moveit_config
demo.launch.py`, ros2_control mock hardware, Lyrical): RobotState with highlights; Trajectory
with a real plan, loop and trail; PlanningScene with a table, a coloured ball and a tool attached
to the hand; MotionPlanning: named goal, dragging the end effector (IK), Plan, Execute — the
robot's joint states ended at the dragged goal.
