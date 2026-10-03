/**
 * Concave hull: the exact outer perimeter of a set of points, passing through the outermost
 * points (no margin, no approximation).
 *
 * Algorithm of github.com/mapbox/concaveman (ISC License, Copyright (c) 2016 Vladimir Agafonkin):
 * start from the convex hull, then "dig" every edge toward the nearest inner point while the edge
 * is long compared to the distance to this point (concavity), without crossing the other edges.
 * Uses a grid as spatial index instead of R-trees.
 */

/** Orientation of the triangle (a, b, c): > 0 counter-clockwise (in y-down coordinates: clockwise) */
function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
	return (by - ay) * (cx - bx) - (bx - ax) * (cy - by);
}

function sqDist(ax: number, ay: number, bx: number, by: number): number {
	const dx = ax - bx;
	const dy = ay - by;
	return dx * dx + dy * dy;
}

/** Square distance from p to the segment [a, b] */
function sqSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
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

/**
 * Convex hull (monotone chain)
 * @returns indices (in `members`' values) of the hull, counter-clockwise in y-down coordinates
 */
export function convexHull(
	xs: Float64Array,
	ys: Float64Array,
	members: ArrayLike<number>,
): number[] {
	const pts = Array.from(members);
	pts.sort(
		(a, b) => (xs[a] as number) - (xs[b] as number) || (ys[a] as number) - (ys[b] as number),
	);
	// remove exact duplicates
	const unique: number[] = [];
	for (const p of pts) {
		const q = unique[unique.length - 1];
		if (q === undefined || xs[q] !== xs[p] || ys[q] !== ys[p]) {
			unique.push(p);
		}
	}
	if (unique.length < 3) {
		return unique;
	}

	const cross = (o: number, a: number, b: number): number =>
		((xs[a] as number) - (xs[o] as number)) * ((ys[b] as number) - (ys[o] as number)) -
		((ys[a] as number) - (ys[o] as number)) * ((xs[b] as number) - (xs[o] as number));

	const lower: number[] = [];
	for (const p of unique) {
		while (
			lower.length >= 2 &&
			cross(lower[lower.length - 2] as number, lower[lower.length - 1] as number, p) <= 0
		) {
			lower.pop();
		}
		lower.push(p);
	}
	const upper: number[] = [];
	for (let i = unique.length - 1; i >= 0; i--) {
		const p = unique[i] as number;
		while (
			upper.length >= 2 &&
			cross(upper[upper.length - 2] as number, upper[upper.length - 1] as number, p) <= 0
		) {
			upper.pop();
		}
		upper.push(p);
	}
	lower.pop();
	upper.pop();
	return lower.concat(upper);
}

interface HullNode {
	p: number;
	prev: HullNode;
	next: HullNode;
}

/** Grid of the remaining (not yet in the hull) points */
class PointGrid {
	private readonly cells: number[][];
	private readonly xs: Float64Array;
	private readonly ys: Float64Array;
	private readonly minX: number;
	private readonly minY: number;
	private readonly cell: number;
	private readonly w: number;
	private readonly h: number;
	readonly used: Set<number> = new Set();

	constructor(
		xs: Float64Array,
		ys: Float64Array,
		members: ArrayLike<number>,
		minX: number,
		minY: number,
		cell: number,
		w: number,
		h: number,
	) {
		this.xs = xs;
		this.ys = ys;
		this.minX = minX;
		this.minY = minY;
		this.cell = cell;
		this.w = w;
		this.h = h;
		this.cells = Array.from(
			{
				length: w * h,
			},
			() => [],
		);
		for (let i = 0; i < members.length; i++) {
			const p = members[i] as number;
			(this.cells[this.cellOf(p)] as number[]).push(p);
		}
	}

	private cellOf(p: number): number {
		const ix = Math.min(
			this.w - 1,
			Math.floor(((this.xs[p] as number) - this.minX) / this.cell),
		);
		const iy = Math.min(
			this.h - 1,
			Math.floor(((this.ys[p] as number) - this.minY) / this.cell),
		);
		return iy * this.w + ix;
	}

	/** Points (not used) in a box */
	query(x0: number, y0: number, x1: number, y1: number, out: number[]): void {
		const ix0 = Math.max(0, Math.floor((x0 - this.minX) / this.cell));
		const iy0 = Math.max(0, Math.floor((y0 - this.minY) / this.cell));
		const ix1 = Math.min(this.w - 1, Math.floor((x1 - this.minX) / this.cell));
		const iy1 = Math.min(this.h - 1, Math.floor((y1 - this.minY) / this.cell));
		for (let iy = iy0; iy <= iy1; iy++) {
			for (let ix = ix0; ix <= ix1; ix++) {
				for (const p of this.cells[iy * this.w + ix] as number[]) {
					if (!this.used.has(p)) {
						out.push(p);
					}
				}
			}
		}
	}
}

/**
 * Concave hull of points
 * @param members indices of the points
 * @param concavity relative measure of concavity: 1 = very concave, Infinity = convex hull (default 2)
 * @param lengthThreshold edges shorter than this length (world units) are not dug (default 0)
 * @returns indices of the points of the ring (closed implicitly), counter-clockwise in y-down
 */
export function concaveHull(
	xs: Float64Array,
	ys: Float64Array,
	members: ArrayLike<number>,
	concavity = 2,
	lengthThreshold = 0,
): number[] {
	const hull = convexHull(xs, ys, members);
	if (hull.length < 3 || !Number.isFinite(concavity)) {
		return hull;
	}

	// spatial index of the points
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < members.length; i++) {
		const p = members[i] as number;
		minX = Math.min(minX, xs[p] as number);
		maxX = Math.max(maxX, xs[p] as number);
		minY = Math.min(minY, ys[p] as number);
		maxY = Math.max(maxY, ys[p] as number);
	}
	const side = Math.max(1, Math.ceil(Math.sqrt(members.length / 2)));
	const cell = Math.max(maxX - minX, maxY - minY, 1e-15) / side;
	const grid = new PointGrid(
		xs,
		ys,
		members,
		minX,
		minY,
		cell,
		Math.floor((maxX - minX) / cell) + 1,
		Math.floor((maxY - minY) / cell) + 1,
	);
	// the hull points (and the points at the same position) are not candidates
	const onHull = new Set(hull.map((h) => `${xs[h]},${ys[h]}`));
	for (let i = 0; i < members.length; i++) {
		const p = members[i] as number;
		if (onHull.has(`${xs[p]},${ys[p]}`)) {
			grid.used.add(p);
		}
	}

	// circular linked list of the hull
	let last: HullNode | null = null;
	const queue: HullNode[] = [];
	for (const p of hull) {
		const node = {
			p,
		} as HullNode;
		if (last) {
			node.prev = last;
			last.next = node;
		}
		last = node;
		queue.push(node);
	}
	const first = queue[0] as HullNode;
	(last as HullNode).next = first;
	first.prev = last as HullNode;

	const sqConcavity = concavity * concavity;
	const sqLenThreshold = lengthThreshold * lengthThreshold;
	const candidates: number[] = [];

	// segments of the hull (to check the intersections)
	const segments = new Set<HullNode>(queue);

	const intersectsHull = (a: number, b: number): boolean => {
		const ax = xs[a] as number;
		const ay = ys[a] as number;
		const bx = xs[b] as number;
		const by = ys[b] as number;
		const x0 = Math.min(ax, bx);
		const x1 = Math.max(ax, bx);
		const y0 = Math.min(ay, by);
		const y1 = Math.max(ay, by);
		for (const s of segments) {
			const c = s.p;
			const d = s.next.p;
			if (c === a || c === b || d === a || d === b) {
				continue;
			}
			const cx = xs[c] as number;
			const cy = ys[c] as number;
			const dx = xs[d] as number;
			const dy = ys[d] as number;
			if (
				Math.max(cx, dx) < x0 ||
				Math.min(cx, dx) > x1 ||
				Math.max(cy, dy) < y0 ||
				Math.min(cy, dy) > y1
			) {
				continue;
			}
			if (
				orient(ax, ay, bx, by, cx, cy) > 0 !== orient(ax, ay, bx, by, dx, dy) > 0 &&
				orient(cx, cy, dx, dy, ax, ay) > 0 !== orient(cx, cy, dx, dy, bx, by) > 0
			) {
				return true;
			}
		}
		return false;
	};

	for (let qi = 0; qi < queue.length; qi++) {
		const node = queue[qi] as HullNode;
		const a = node.p;
		const b = node.next.p;
		const ax = xs[a] as number;
		const ay = ys[a] as number;
		const bx = xs[b] as number;
		const by = ys[b] as number;

		// skip the edge if it's already short enough
		const sqLen = sqDist(ax, ay, bx, by);
		if (sqLen < sqLenThreshold) {
			continue;
		}
		const maxSqLen = sqLen / sqConcavity;

		// candidates: points near the edge, nearest first
		const r = Math.sqrt(maxSqLen);
		candidates.length = 0;
		grid.query(
			Math.min(ax, bx) - r,
			Math.min(ay, by) - r,
			Math.max(ax, bx) + r,
			Math.max(ay, by) + r,
			candidates,
		);
		if (candidates.length === 0) {
			continue;
		}
		const pa = node.prev.p;
		const pd = node.next.next.p;
		const scored: [
			number,
			number,
		][] = [];
		for (const p of candidates) {
			const d = sqSegDist(xs[p] as number, ys[p] as number, ax, ay, bx, by);
			if (d <= maxSqLen) {
				scored.push([
					d,
					p,
				]);
			}
		}
		scored.sort((u, v) => u[0] - v[0]);

		let found = -1;
		for (const [d, p] of scored) {
			const px = xs[p] as number;
			const py = ys[p] as number;
			// the point must be nearer to this edge than to the neighbor edges
			if (
				d < sqSegDist(px, py, xs[pa] as number, ys[pa] as number, ax, ay) &&
				d < sqSegDist(px, py, bx, by, xs[pd] as number, ys[pd] as number) &&
				!intersectsHull(a, p) &&
				!intersectsHull(b, p)
			) {
				found = p;
				break;
			}
		}

		if (
			found >= 0 &&
			Math.min(
				sqDist(xs[found] as number, ys[found] as number, ax, ay),
				sqDist(xs[found] as number, ys[found] as number, bx, by),
			) <= maxSqLen
		) {
			// insert the point between a and b
			const inserted: HullNode = {
				p: found,
				prev: node,
				next: node.next,
			};
			node.next.prev = inserted;
			node.next = inserted;
			grid.used.add(found);
			segments.add(inserted);
			queue.push(node, inserted);
		}
	}

	// ring
	const ring: number[] = [];
	let n: HullNode = first;
	do {
		ring.push(n.p);
		n = n.next;
	} while (n !== first);
	return ring;
}
