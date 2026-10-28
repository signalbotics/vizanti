import test from 'node:test';
import assert from 'node:assert/strict';
import { ActionDispatcher, actionClient } from '../../public/js/core/actions.js';

test('a goal is sent, gets feedback, and resolves with its result', async () => {
	const sent = [];
	const d = new ActionDispatcher((m) => sent.push(m));
	const feedback = [];
	const client = actionClient(d, "/fib", "example_interfaces/action/Fibonacci");
	const goal = client.send({ order: 3 }, { onFeedback: (f) => feedback.push(f) });
	assert.deepEqual(sent[0], { op: "send_action_goal", id: goal.id, action: "/fib", action_type: "example_interfaces/action/Fibonacci", args: { order: 3 }, feedback: true });
	assert.equal(d.handle({ op: "action_feedback", id: goal.id, values: { sequence: [0, 1] } }), true);
	assert.equal(d.handle({ op: "action_feedback", id: "someone_else", values: {} }), false);
	assert.equal(d.handle({ op: "publish", topic: "/x" }), false);
	d.handle({ op: "action_result", id: goal.id, values: { sequence: [0, 1, 1, 2] }, status: 4, result: true });
	assert.deepEqual(await goal.result, { status: "succeeded", values: { sequence: [0, 1, 1, 2] }, ok: true });
	assert.deepEqual(feedback, [{ sequence: [0, 1] }]);
	goal.cancel(); // finished: nothing is sent
	assert.equal(sent.length, 1);
});

test('cancel asks rosbridge; a failure and a lost connection resolve the goal', async () => {
	const sent = [];
	const d = new ActionDispatcher((m) => sent.push(m));
	const a = d.sendGoal("/nav", "nav2_msgs/action/NavigateToPose", {});
	a.cancel();
	assert.deepEqual(sent.at(-1), { op: "cancel_action_goal", id: a.id, action: "/nav" });
	assert.equal(sent[0].feedback, false);
	d.handle({ op: "action_result", id: a.id, values: "No action server", status: 0, result: false });
	assert.deepEqual(await a.result, { status: "unknown", values: "No action server", ok: false });
	const b = d.sendGoal("/nav", "nav2_msgs/action/NavigateToPose", {});
	d.disconnected();
	const r = await b.result;
	assert.equal(r.ok, false);
	assert.match(r.values, /lost/);
});
