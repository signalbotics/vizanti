// What the status bar says: the rosbridge connection, whether the fixed frame exists in TF,
// and how many displays have problems. Pure, so it can be tested without a page.

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ros: { connected, status, url }; frames: Set of known TF frames; items: registry items
export function summarizeStatus(ros, fixedFrame, frames, items) {
	const connection = ros.connected
		? { level: "ok", text: `Connected to ${ros.url}` }
		: { level: "error", text: ros.status || "Not connected." };

	let frame;
	if (!fixedFrame)
		frame = { level: "error", text: "No fixed frame set" };
	else if (frames.size === 0)
		frame = { level: "warn", text: `Fixed frame: ${fixedFrame} (no TF received yet)` };
	else if (!frames.has(fixedFrame))
		frame = { level: "error", text: `Fixed frame "${fixedFrame}" does not exist in TF` };
	else
		frame = { level: "ok", text: `Fixed frame: ${fixedFrame}` };

	let errors = 0, warnings = 0, firstError = null, firstWarning = null;
	for (const item of items) {
		if (!item.enabled)
			continue;
		if (item.status.level === "error") {
			errors++;
			firstError ??= item.id;
		} else if (item.status.level === "warn") {
			warnings++;
			firstWarning ??= item.id;
		}
	}
	const displays = errors + warnings === 0
		? { level: "ok", text: "All displays OK", errors, warnings, firstProblemId: null }
		: {
			level: errors ? "error" : "warn",
			text: [errors && plural(errors, "error"), warnings && plural(warnings, "warning")].filter(Boolean).join(", "),
			errors,
			warnings,
			firstProblemId: firstError ?? firstWarning,
		};

	return { connection, frame, displays };
}

export function renderRate(frames, milliseconds) {
	return milliseconds > 0 ? Math.round(frames * 1000 / milliseconds) : 0;
}
