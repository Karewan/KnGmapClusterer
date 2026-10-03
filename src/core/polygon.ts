/**
 * Polygon helpers (rings of point indices in world coordinates)
 */

/** Is (x, y) inside the ring? (ray casting, even-odd) */
export function pointInRing(
	xs: ArrayLike<number>,
	ys: ArrayLike<number>,
	ring: ArrayLike<number>,
	x: number,
	y: number,
): boolean {
	let inside = false;
	const n = ring.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const a = ring[i] as number;
		const b = ring[j] as number;
		const ax = xs[a] as number;
		const ay = ys[a] as number;
		const bx = xs[b] as number;
		const by = ys[b] as number;
		if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) {
			inside = !inside;
		}
	}
	return inside;
}

/** Signed distance from a point to the ring outline (positive inside) */
function signedDistance(
	xs: ArrayLike<number>,
	ys: ArrayLike<number>,
	ring: ArrayLike<number>,
	x: number,
	y: number,
): number {
	let min = Number.POSITIVE_INFINITY;
	const n = ring.length;
	for (let i = 0, j = n - 1; i < n; j = i++) {
		const a = ring[i] as number;
		const b = ring[j] as number;
		let px = xs[a] as number;
		let py = ys[a] as number;
		let dx = (xs[b] as number) - px;
		let dy = (ys[b] as number) - py;
		if (dx !== 0 || dy !== 0) {
			const t = ((x - px) * dx + (y - py) * dy) / (dx * dx + dy * dy);
			if (t > 1) {
				px = xs[b] as number;
				py = ys[b] as number;
			} else if (t > 0) {
				px += dx * t;
				py += dy * t;
			}
		}
		dx = x - px;
		dy = y - py;
		min = Math.min(min, dx * dx + dy * dy);
	}
	return (pointInRing(xs, ys, ring, x, y) ? 1 : -1) * Math.sqrt(min);
}

interface Cell {
	readonly x: number;
	readonly y: number;
	readonly h: number;
	readonly d: number;
	readonly max: number;
}

/**
 * Pole of inaccessibility: the point inside the ring farthest from its outline (best place for
 * a label, inside even for C shaped polygons).
 * Port of github.com/mapbox/polylabel (ISC License, Copyright (c) 2016 Mapbox).
 */
export function poleOfInaccessibility(
	xs: ArrayLike<number>,
	ys: ArrayLike<number>,
	ring: ArrayLike<number>,
	precisionRatio = 0.005,
): [
	number,
	number,
] {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < ring.length; i++) {
		const p = ring[i] as number;
		minX = Math.min(minX, xs[p] as number);
		maxX = Math.max(maxX, xs[p] as number);
		minY = Math.min(minY, ys[p] as number);
		maxY = Math.max(maxY, ys[p] as number);
	}
	const width = maxX - minX;
	const height = maxY - minY;
	const cellSize = Math.min(width, height);
	if (ring.length < 3 || cellSize === 0) {
		return [
			(minX + maxX) / 2,
			(minY + maxY) / 2,
		];
	}
	const precision = Math.max(width, height) * precisionRatio;

	const cell = (x: number, y: number, h: number): Cell => {
		const d = signedDistance(xs, ys, ring, x, y);
		return {
			x,
			y,
			h,
			d,
			max: d + h * Math.SQRT2,
		};
	};

	// max-heap on cell.max
	const heap: Cell[] = [];
	const push = (c: Cell): void => {
		heap.push(c);
		let i = heap.length - 1;
		while (i > 0) {
			const parent = (i - 1) >> 1;
			if ((heap[parent] as Cell).max >= c.max) {
				break;
			}
			heap[i] = heap[parent] as Cell;
			i = parent;
		}
		heap[i] = c;
	};
	const pop = (): Cell | undefined => {
		const top = heap[0];
		const lastCell = heap.pop();
		if (heap.length > 0 && lastCell) {
			let i = 0;
			const n = heap.length;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let m = i;
				let mv = lastCell.max;
				if (l < n && (heap[l] as Cell).max > mv) {
					m = l;
					mv = (heap[l] as Cell).max;
				}
				if (r < n && (heap[r] as Cell).max > mv) {
					m = r;
				}
				if (m === i) {
					break;
				}
				heap[i] = heap[m] as Cell;
				i = m;
			}
			heap[i] = lastCell;
		}
		return top;
	};

	const h = cellSize / 2;
	for (let x = minX; x < maxX; x += cellSize) {
		for (let y = minY; y < maxY; y += cellSize) {
			push(cell(x + h, y + h, h));
		}
	}

	// first guess: centroid of the vertices, then the center of the bbox
	let sx = 0;
	let sy = 0;
	for (let i = 0; i < ring.length; i++) {
		sx += xs[ring[i] as number] as number;
		sy += ys[ring[i] as number] as number;
	}
	let best = cell(sx / ring.length, sy / ring.length, 0);
	const bboxCell = cell(minX + width / 2, minY + height / 2, 0);
	if (bboxCell.d > best.d) {
		best = bboxCell;
	}

	for (let c = pop(); c; c = pop()) {
		if (c.d > best.d) {
			best = c;
		}
		if (c.max - best.d <= precision) {
			continue;
		}
		const ch = c.h / 2;
		push(cell(c.x - ch, c.y - ch, ch));
		push(cell(c.x + ch, c.y - ch, ch));
		push(cell(c.x - ch, c.y + ch, ch));
		push(cell(c.x + ch, c.y + ch, ch));
	}

	return [
		best.x,
		best.y,
	];
}
