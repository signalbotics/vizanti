// ROS 2 action client over rosbridge ("send_action_goal"). The vendored roslib only knows
// ROS 1 actions and drops rosbridge's "action_feedback" / "action_result" messages, so those
// are read from the socket here and matched to goals by id.

// action_msgs/GoalStatus
export const GOAL_STATUS = {
	0: "unknown", 1: "accepted", 2: "executing", 3: "canceling", 4: "succeeded", 5: "canceled", 6: "aborted",
};

export class ActionDispatcher {

	// send(message): hands a rosbridge message to the connection
	constructor(send) {
		this.send = send;
		this.goals = new Map(); // id -> { onFeedback, resolve }
		this.seq = 0;
	}

	// One goal. Resolves `result` with { status: "succeeded" | "aborted" | ..., values, ok } where
	// ok is false when rosbridge could not reach the action server (values is then its error text).
	sendGoal(action, actionType, goal, { onFeedback = null } = {}) {
		const id = `vizanti_action_${++this.seq}_${Date.now().toString(36)}`;
		let resolve;
		const result = new Promise((r) => { resolve = r; });
		this.goals.set(id, { onFeedback, resolve });
		this.send({ op: "send_action_goal", id, action, action_type: actionType, args: goal, feedback: !!onFeedback });
		return {
			id,
			result,
			cancel: () => {
				if (this.goals.has(id))
					this.send({ op: "cancel_action_goal", id, action });
			},
		};
	}

	// a rosbridge message; true when it was for one of our goals
	handle(message) {
		if (message?.op !== "action_feedback" && message?.op !== "action_result")
			return false;
		const goal = this.goals.get(message.id);
		if (!goal)
			return false;
		if (message.op === "action_feedback") {
			try {
				goal.onFeedback?.(message.values);
			} catch (e) {
				console.error(`Action feedback handler for ${message.action} failed:`, e);
			}
			return true;
		}
		this.goals.delete(message.id);
		goal.resolve({ status: GOAL_STATUS[message.status] ?? `status ${message.status}`, values: message.values, ok: message.result !== false });
		return true;
	}

	// the connection dropped: rosbridge forgets its goals, so every waiting one ends here
	disconnected() {
		for (const [id, goal] of this.goals) {
			this.goals.delete(id);
			goal.resolve({ status: "unknown", values: "The connection to the robot was lost.", ok: false });
		}
	}
}

// Wires a dispatcher to Vizanti's rosbridge connection (and its reconnections).
export function connectActions(rosbridge) {
	const dispatcher = new ActionDispatcher((message) => rosbridge.ros.callOnConnection(message));
	const onMessage = (event) => {
		if (typeof event.data !== "string" || !event.data.includes("\"action_"))
			return; // binary (CBOR) frames are subscriptions; action messages are JSON text
		try {
			dispatcher.handle(JSON.parse(event.data));
		} catch (e) { /* not JSON we care about */ }
	};
	let socket = null;
	const attach = () => {
		const next = rosbridge.ros.socket;
		if (next === socket || !next?.addEventListener)
			return;
		socket?.removeEventListener?.("message", onMessage);
		socket = next;
		socket.addEventListener("message", onMessage);
	};
	rosbridge.ros.on("connection", attach);
	rosbridge.ros.on("close", () => dispatcher.disconnected());
	attach();
	return dispatcher;
}

// A client for one action, as plugins see it: ctx.action("/navigate_to_pose", "nav2_msgs/action/NavigateToPose")
export function actionClient(dispatcher, name, type) {
	return {
		name,
		type,
		send: (goal, options) => dispatcher.sendGoal(name, type, goal, options),
	};
}
