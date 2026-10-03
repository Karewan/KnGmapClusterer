/**
 * Douglas-Peucker polyline simplification, precomputed once for every zoom level.
 *
 * Instead of simplifying the line for each zoom, each vertex gets an "importance": the
 * largest tolerance for which it is still kept. Importances are made monotonic (a vertex is
 * never more important than the one that split its parent segment), so filtering the vertices
 * with `importance >= tolerance` gives exactly the Douglas-Peucker result for that tolerance.
 */

/**
 * Compute the importance (in world units) of each vertex of a polyline
 */
export function simplifyImportance(xs: Float64Array, ys: Float64Array): Float64Array {
	const n = xs.length;
	const imp = new Float64Array(n);
	if (n === 0) {
		return imp;
	}

	imp[0] = Number.POSITIVE_INFINITY;
	imp[n - 1] = Number.POSITIVE_INFINITY;

	// [first, last, parent importance]
	const stack: number[] = [
		0,
		n - 1,
		Number.POSITIVE_INFINITY,
	];

	while (stack.length > 0) {
		const parentImp = stack.pop() as number;
		const last = stack.pop() as number;
		const first = stack.pop() as number;

		if (last - first < 2) {
			continue;
		}

		let maxSqDist = -1;
		let index = first + 1;

		const ax = xs[first] as number;
		const ay = ys[first] as number;
		const bx = xs[last] as number;
		const by = ys[last] as number;

		for (let i = first + 1; i < last; i++) {
			const d = sqSegDist(xs[i] as number, ys[i] as number, ax, ay, bx, by);
			if (d > maxSqDist) {
				maxSqDist = d;
				index = i;
			}
		}

		const value = Math.min(Math.sqrt(maxSqDist), parentImp);
		imp[index] = value;
		stack.push(first, index, value, index, last, value);
	}

	return imp;
}

/**
 * Indices of the vertices kept for a tolerance
 */
export function simplifiedIndices(
	importance: Float64Array,
	tolerance: number,
	out: number[] = [],
): number[] {
	for (let i = 0; i < importance.length; i++) {
		if ((importance[i] as number) >= tolerance) {
			out.push(i);
		}
	}
	return out;
}

/** Square distance from a point to a segment */
export function sqSegDist(
	px: number,
	py: number,
	ax: number,
	ay: number,
	bx: number,
	by: number,
): number {
	let x = ax;
	let y = ay;
	let dx = bx - x;
	let dy = by - y;

	if (dx !== 0 || dy !== 0) {
		const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
		if (t > 1) {
			x = bx;
			y = by;
		} else if (t > 0) {
			x += dx * t;
			y += dy * t;
		}
	}

	dx = px - x;
	dy = py - y;
	return dx * dx + dy * dy;
}
