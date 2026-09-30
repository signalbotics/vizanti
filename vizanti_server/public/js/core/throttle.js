// Runs fn at most once per `ms`, after the burst. cancel() drops a pending run and
// turns later calls into no-ops, for when the page is about to be replaced.
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

	run.cancel = () => {
		cancelled = true;
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
	};

	return run;
}
