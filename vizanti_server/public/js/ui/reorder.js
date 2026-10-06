// Where a dragged row lands. from: its index now; over: the index of the row it is dropped on;
// after: dropped on the lower half of that row. Returns the index for registry.move().
export function dropIndex(from, over, after) {
	let to = over + (after ? 1 : 0);
	if (from < to)
		to -= 1; // the row itself leaves the list first
	return to;
}
