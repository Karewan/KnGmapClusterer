/**
 * Heatmap helpers: weighted aggregation of the points in cells (bounded number of splats to draw,
 * whatever the number of points) and estimation of the max density (automatic normalization).
 */

import { encode } from "./cluster-index.ts";
import { buildGrid, SpatialGrid } from "./grid.ts";

/** Kernel of a splat: weight * exp(-HEAT_K * d²), d = distance / radius in [0, 1] */
export const HEAT_K = 4;

export interface HeatCells {
	/** world position (weighted centroid) of each cell */
	readonly x: Float64Array;
	readonly y: Float64Array;
	/** sum (or max) of the weights */
	readonly w: Float64Array;
	readonly count: number;
}

/**
 * How the weights are combined: `sum` = density, `max` = strongest value (measurements)
 */
export type HeatAggregate = "sum" | "max";

/**
 * Aggregate the points in cells of `cell` world units
 * @param ws weight of each point (points with a weight <= 0 are ignored)
 * @param mode `sum`: weighted centroid and sum of the weights; `max`: the strongest point of the cell
 */
export function aggregateHeat(
	xs: Float64Array,
	ys: Float64Array,
	ws: Float64Array,
	cell: number,
	mode: HeatAggregate = "sum",
): HeatCells {
	const n = xs.length;
	const coords = new Int32Array(n * 2);
	for (let i = 0; i < n; i++) {
		coords[2 * i] = encode(xs[i] as number);
		coords[2 * i + 1] = encode(ys[i] as number);
	}
	const g = buildGrid(coords, 2, n, cell * 2 ** 30);
	const cells = g.start.length - 1;
	const x = new Float64Array(cells);
	const y = new Float64Array(cells);
	const w = new Float64Array(cells);
	let count = 0;

	for (let c = 0; c < cells; c++) {
		if (mode === "max") {
			let best = -1;
			let bw = 0;
			for (let j = g.start[c] as number; j < (g.start[c + 1] as number); j++) {
				const i = g.items[j] as number;
				const wi = ws[i] as number;
				if (wi > bw) {
					bw = wi;
					best = i;
				}
			}
			if (best >= 0) {
				x[count] = xs[best] as number;
				y[count] = ys[best] as number;
				w[count] = bw;
				count++;
			}
			continue;
		}
		let sw = 0;
		let sx = 0;
		let sy = 0;
		for (let j = g.start[c] as number; j < (g.start[c + 1] as number); j++) {
			const i = g.items[j] as number;
			const wi = ws[i] as number;
			if (!(wi > 0)) {
				continue;
			}
			sw += wi;
			sx += (xs[i] as number) * wi;
			sy += (ys[i] as number) * wi;
		}
		if (sw > 0) {
			x[count] = sx / sw;
			y[count] = sy / sw;
			w[count] = sw;
			count++;
		}
	}

	return {
		x: x.subarray(0, count),
		y: y.subarray(0, count),
		w: w.subarray(0, count),
		count,
	};
}

/**
 * Max of the density (sum of the kernels) at the cells positions
 * @param radius splat radius in world units
 * @param mode `max`: the strongest value (the kernels are not summed)
 */
export function maxHeat(cells: HeatCells, radius: number, mode: HeatAggregate = "sum"): number {
	const n = cells.count;
	if (n === 0) {
		return 0;
	}
	if (mode === "max") {
		let max = 0;
		for (let i = 0; i < n; i++) {
			max = Math.max(max, cells.w[i] as number);
		}
		return max;
	}
	const coords = new Int32Array(n * 2);
	for (let i = 0; i < n; i++) {
		coords[2 * i] = encode(cells.x[i] as number);
		coords[2 * i + 1] = encode(cells.y[i] as number);
	}
	const r = radius * 2 ** 30;
	const grid = new SpatialGrid(buildGrid(coords, 2, n, r), coords, 2);
	const near = new Uint32Array(n);
	const r2 = r * r;
	let max = 0;

	for (let i = 0; i < n; i++) {
		const cx = coords[2 * i] as number;
		const cy = coords[2 * i + 1] as number;
		const k = grid.withinInto(cx, cy, r, near);
		let sum = 0;
		for (let j = 0; j < k; j++) {
			const o = near[j] as number;
			const dx = (coords[2 * o] as number) - cx;
			const dy = (coords[2 * o + 1] as number) - cy;
			sum += (cells.w[o] as number) * Math.exp((-HEAT_K * (dx * dx + dy * dy)) / r2);
		}
		max = Math.max(max, sum);
	}
	return max;
}
