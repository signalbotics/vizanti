// Runs fn at most once per `ms`, after the burst. flush() runs a pending call at once;
// cancel() drops it and turns later calls into no-ops, for when the page is about to be replaced.
export function throttled(fn, ms) {
	let timer = null;
	let cancelled = false;

	const run = () => {
		if (cancelled || timer !== null)
			return;
		timer = setTimeout(() => {
			timer = null;
			fn();
		}, ms);
	};

	// runs a pending call now (the page is closing: a timer would never fire)
	run.flush = () => {
		if (cancelled || timer === null)
			return;
		clearTimeout(timer);
		timer = null;
		fn();
	};

	run.cancel = () => {
		cancelled = true;
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	return run;
}
