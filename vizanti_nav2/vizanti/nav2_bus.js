// What RViz does in-process with nav2_rviz_plugins' GoalUpdater: the Nav2 Goal tool hands each
// pose it sets to the Navigation 2 panels on the page. Both modules import this one file, so they
// share it. A tool with nobody listening sends the goal itself.
export const nav2Bus = new EventTarget();

// pose: { frame, x, y, yaw }; true when a panel took it
export function handGoal(pose) {
	const event = new CustomEvent("goal", { detail: pose, cancelable: true });
	nav2Bus.dispatchEvent(event);
	return event.defaultPrevented;
}
