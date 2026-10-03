/**
 * Hierarchical greedy clustering index.
 * Stripped down TypeScript port of github.com/mapbox/supercluster v9.1.0
 * (ISC License, Copyright (c) 2021 Mapbox), reworked to:
 * - work directly on world coordinates encoded as int32 (V8 small integer fast path),
 * - produce flat typed arrays only (transferable from a worker without copy),
 * - support declarative aggregates (sum, min, max, avg, countBy) in a parallel float64 array,
 * - optionally group exact duplicates into a single weighted leaf.
 */

import { mergeColumns } from "./aggregate.ts";
import { buildGrid, type GridData, gridBuffers, SpatialGrid } from "./grid.ts";

// Int32 encoding of world coords in [0, 1]: (coord - 0.5) * SCALE in [-2^29, 2^29]
const SCALE = 0x40000000;
const INV_SCALE = 1 / SCALE;

/** World coordinate to int32 */
export function encode(c: number): number {
	return (c - 0.5) * SCALE;
}

/** int32 to world coordinate */
export function decode(v: number): number {
	return v * INV_SCALE + 0.5;
}

export const OFFSET_X = 0;
export const OFFSET_Y = 1;
export const OFFSET_ZOOM = 2;
export const OFFSET_ID = 3;
export const OFFSET_PARENT = 4;
export const OFFSET_NUM = 5;
export const STRIDE = 6;

export interface ClusterIndexOptions {
	/** min zoom to generate clusters on */
	readonly minZoom: number;
	/** max zoom level to cluster the points on */
	readonly maxZoom: number;
	/** minimum points to form a cluster */
	readonly minPoints: number;
	/** cluster radius in pixels (relative to extent) */
	readonly radius: number;
	/** tile extent (radius is calculated relative to it) */
	readonly extent: number;
	/** group points sharing the exact same position into a single weighted leaf */
	readonly groupDuplicates: boolean;
}

export interface ClusterIndexInput {
	/** world x of each point */
	readonly xs: Float64Array;
	/** world y of each point */
	readonly ys: Float64Array;
	/** aggregate columns (n * ops.length) */
	readonly agg: Float64Array;
	/** merge operation of each aggregate column */
	readonly ops: Uint8Array;
}

export interface ClusterLevelData {
	/** rows of STRIDE int32: x, y, zoom, id, parent, num */
	readonly data: Int32Array;
	/** aggregate columns of each row */
	readonly agg: Float64Array;
	/** spatial index of the rows */
	readonly grid: GridData;
}

/** Plain, transferable, representation of a built index */
export interface ClusterIndexData {
	readonly numPoints: number;
	readonly options: ClusterIndexOptions;
	readonly cols: number;
	/** levels[zoom - minZoom], the last level (maxZoom + 1) holds the leaves */
	readonly levels: readonly ClusterLevelData[];
	/** next point of the same duplicates group (-1 = end of group), null if not grouped */
	readonly dupNext: Int32Array | null;
}

export interface ClusterLevel {
	readonly zoom: number;
	readonly data: Int32Array;
	readonly agg: Float64Array;
	readonly grid: SpatialGrid;
}

/**
 * Group the rows sharing the exact same (int32) coordinates.
 * Duplicates are in the same grid cell: only the cells holding several rows are checked.
 * @returns dupNext: next row of the group (-1 = last), leader: 1 if the row leads its group
 * (the smallest index of the group)
 */
export function groupDuplicates(
	data: Int32Array,
	grid: GridData,
): {
	dupNext: Int32Array;
	leader: Uint8Array;
	count: number;
} {
	const n = grid.numItems;
	const dupNext = new Int32Array(n).fill(-1);
	const leader = new Uint8Array(n).fill(1);
	const { start, items } = grid;
	const run: number[] = [];
	let count = 0;

	for (let c = 0; c < start.length - 1; c++) {
		const s0 = start[c] as number;
		const s1 = start[c + 1] as number;
		if (s1 - s0 < 2) {
			continue;
		}
		run.length = 0;
		for (let j = s0; j < s1; j++) {
			run.push(items[j] as number);
		}
		run.sort((p, q) => {
			const dx = (data[p * STRIDE] as number) - (data[q * STRIDE] as number);
			if (dx !== 0) {
				return dx;
			}
			const dy = (data[p * STRIDE + 1] as number) - (data[q * STRIDE + 1] as number);
			return dy !== 0 ? dy : p - q;
		});
		for (let j = 1; j < run.length; j++) {
			const prev = run[j - 1] as number;
			const cur = run[j] as number;
			if (
				data[prev * STRIDE] === data[cur * STRIDE] &&
				data[prev * STRIDE + 1] === data[cur * STRIDE + 1]
			) {
				dupNext[prev] = cur;
				leader[cur] = 0;
				count++;
			}
		}
	}

	return {
		dupNext,
		leader,
		count,
	};
}

/**
 * Radius (int32 units) of the queries made on the level of a zoom:
 * clustering at zoom z - 1 and children of the clusters originated at zoom z
 */
function levelRadius(opts: ClusterIndexOptions, zoom: number): number {
	return (opts.radius / (opts.extent * 2 ** (zoom - 1))) * SCALE;
}

function createGrid(
	data: Int32Array,
	numItems: number,
	opts: ClusterIndexOptions,
	zoom: number,
): GridData {
	return buildGrid(data, STRIDE, numItems, levelRadius(opts, zoom));
}

/**
 * Build the whole index (CPU heavy: meant to run in a worker for big datasets)
 */
export function buildClusterIndex(
	input: ClusterIndexInput,
	opts: ClusterIndexOptions,
): ClusterIndexData {
	const { xs, ys, agg, ops } = input;
	const n = xs.length;
	const cols = ops.length;
	const { minZoom, maxZoom } = opts;
	const notProcessed = maxZoom + 1;

	// Leaves: row i = point i
	let data: Int32Array = new Int32Array(n * STRIDE);
	let aggData: Float64Array = agg.length === n * cols ? agg : new Float64Array(n * cols);
	for (let i = 0; i < n; i++) {
		const k = i * STRIDE;
		data[k + OFFSET_X] = encode(xs[i] as number);
		data[k + OFFSET_Y] = encode(ys[i] as number);
		data[k + OFFSET_ZOOM] = notProcessed;
		data[k + OFFSET_ID] = i;
		data[k + OFFSET_PARENT] = -1;
		data[k + OFFSET_NUM] = 1;
	}
	let rows = n;
	let grid = createGrid(data, rows, opts, maxZoom + 1);

	// Duplicates are merged into their leader (weight + aggregates)
	let dupNext: Int32Array | null = null;
	if (opts.groupDuplicates && n > 1) {
		const dup = groupDuplicates(data, grid);
		if (dup.count > 0) {
			dupNext = dup.dupNext;
			const leaves = new Int32Array((n - dup.count) * STRIDE);
			const leavesAgg = new Float64Array((n - dup.count) * cols);
			rows = 0;
			for (let i = 0; i < n; i++) {
				if (dup.leader[i] === 0) {
					continue;
				}
				const k = rows * STRIDE;
				for (let j = 0; j < STRIDE; j++) {
					leaves[k + j] = data[i * STRIDE + j] as number;
				}
				if (cols > 0) {
					leavesAgg.set(aggData.subarray(i * cols, i * cols + cols), rows * cols);
				}
				for (let j = dupNext[i] as number; j !== -1; j = dupNext[j] as number) {
					leaves[k + OFFSET_NUM] = (leaves[k + OFFSET_NUM] as number) + 1;
					if (cols > 0) {
						mergeColumns(ops, leavesAgg, rows * cols, aggData, j * cols);
					}
				}
				rows++;
			}
			data = leaves;
			aggData = leavesAgg;
			grid = createGrid(data, rows, opts, maxZoom + 1);
		}
	}

	const levels: ClusterLevelData[] = new Array<ClusterLevelData>(maxZoom - minZoom + 2);
	levels[maxZoom + 1 - minZoom] = {
		data,
		agg: aggData,
		grid,
	};

	const neighbors = new Uint32Array(rows);
	let recycled: {
		out: Int32Array;
		aggOut: Float64Array;
	} | null = null;

	for (let z = maxZoom; z >= minZoom; z--) {
		const out: Int32Array = recycled?.out ?? new Int32Array(rows * STRIDE);
		const aggOut: Float64Array = recycled?.aggOut ?? new Float64Array(rows * cols);
		recycled = null;
		const written = clusterLevel(
			data,
			aggData,
			rows,
			new SpatialGrid(grid, data, STRIDE),
			z,
			n,
			opts,
			ops,
			out,
			aggOut,
			neighbors,
		);

		if (written === rows) {
			// No cluster formed: same rows in the same order, reuse the level above (and the slabs)
			levels[z - minZoom] = levels[z + 1 - minZoom] as ClusterLevelData;
			recycled = {
				out,
				aggOut,
			};
		} else {
			// tight views (no copy): the slab is exactly the size of the previous level
			data = out.subarray(0, written * STRIDE);
			aggData = aggOut.subarray(0, written * cols);
			rows = written;
			grid = createGrid(data, rows, opts, z);
			levels[z - minZoom] = {
				data,
				agg: aggData,
				grid,
			};
		}
	}

	return {
		numPoints: n,
		options: opts,
		cols,
		levels,
		dupNext,
	};
}

function clusterLevel(
	data: Int32Array,
	agg: Float64Array,
	numItems: number,
	grid: SpatialGrid,
	zoom: number,
	numPoints: number,
	opts: ClusterIndexOptions,
	ops: Uint8Array,
	out: Int32Array,
	aggOut: Float64Array,
	neighbors: Uint32Array,
): number {
	const r = levelRadius(opts, zoom + 1);
	const notProcessed = opts.maxZoom + 1;
	const cols = ops.length;
	const limit = numItems * STRIDE;
	let cursor = 0;

	for (let i = 0; i < limit; i += STRIDE) {
		// already visited at this zoom
		if ((data[i + OFFSET_ZOOM] as number) <= zoom) {
			continue;
		}
		data[i + OFFSET_ZOOM] = zoom;

		const x = data[i] as number;
		const y = data[i + 1] as number;
		const count = grid.withinInto(x, y, r, neighbors);

		const numOrigin = data[i + OFFSET_NUM] as number;
		let num = numOrigin;

		for (let nb = 0; nb < count; nb++) {
			const k = (neighbors[nb] as number) * STRIDE;
			if ((data[k + OFFSET_ZOOM] as number) > zoom) {
				num += data[k + OFFSET_NUM] as number;
			}
		}

		const row = cursor / STRIDE;

		if (num > numOrigin && num >= opts.minPoints) {
			let wx = x * numOrigin;
			let wy = y * numOrigin;

			// encode both zoom and row index on which the cluster originated, offset by the number of points
			const id = ((i / STRIDE) << 5) + (zoom + 1) + numPoints;

			if (cols > 0) {
				aggOut.set(
					agg.subarray((i / STRIDE) * cols, (i / STRIDE) * cols + cols),
					row * cols,
				);
			}

			for (let nb = 0; nb < count; nb++) {
				const k = (neighbors[nb] as number) * STRIDE;
				if ((data[k + OFFSET_ZOOM] as number) <= zoom) {
					continue;
				}
				data[k + OFFSET_ZOOM] = zoom;

				const num2 = data[k + OFFSET_NUM] as number;
				wx += (data[k] as number) * num2;
				wy += (data[k + 1] as number) * num2;
				data[k + OFFSET_PARENT] = id;
				if (cols > 0) {
					mergeColumns(ops, aggOut, row * cols, agg, (k / STRIDE) * cols);
				}
			}

			data[i + OFFSET_PARENT] = id;
			out[cursor] = wx / num;
			out[cursor + 1] = wy / num;
			out[cursor + OFFSET_ZOOM] = notProcessed;
			out[cursor + OFFSET_ID] = id;
			out[cursor + OFFSET_PARENT] = -1;
			out[cursor + OFFSET_NUM] = num;
			cursor += STRIDE;
		} else {
			// left unclustered
			for (let j = 0; j < STRIDE; j++) {
				out[cursor + j] = data[i + j] as number;
			}
			if (cols > 0) {
				aggOut.set(
					agg.subarray((i / STRIDE) * cols, (i / STRIDE) * cols + cols),
					row * cols,
				);
			}
			cursor += STRIDE;

			if (num > 1) {
				for (let nb = 0; nb < count; nb++) {
					const k = (neighbors[nb] as number) * STRIDE;
					if ((data[k + OFFSET_ZOOM] as number) <= zoom) {
						continue;
					}
					data[k + OFFSET_ZOOM] = zoom;
					for (let j = 0; j < STRIDE; j++) {
						out[cursor + j] = data[k + j] as number;
					}
					if (cols > 0) {
						const r2 = cursor / STRIDE;
						aggOut.set(
							agg.subarray((k / STRIDE) * cols, (k / STRIDE) * cols + cols),
							r2 * cols,
						);
					}
					cursor += STRIDE;
				}
			}
		}
	}

	return cursor / STRIDE;
}

/** ArrayBuffers of an index, to transfer it without copy (levels can share buffers) */
export function clusterIndexTransferables(d: ClusterIndexData): ArrayBuffer[] {
	const set = new Set<ArrayBuffer>();
	for (const l of d.levels) {
		set.add(l.data.buffer as ArrayBuffer);
		set.add(l.agg.buffer as ArrayBuffer);
		for (const b of gridBuffers(l.grid)) {
			set.add(b);
		}
	}
	if (d.dupNext) {
		set.add(d.dupNext.buffer as ArrayBuffer);
	}
	return [
		...set,
	];
}

/**
 * Query side of the index (main thread)
 */
export class ClusterIndex {
	readonly numPoints: number;
	readonly options: ClusterIndexOptions;
	readonly cols: number;
	readonly dupNext: Int32Array | null;
	private readonly levels: ClusterLevel[];

	constructor(d: ClusterIndexData) {
		this.numPoints = d.numPoints;
		this.options = d.options;
		this.cols = d.cols;
		this.dupNext = d.dupNext;

		// levels sharing the same data share the same grid
		const grids = new Map<GridData, SpatialGrid>();
		this.levels = d.levels.map((l, i) => {
			let grid = grids.get(l.grid);
			if (!grid) {
				grid = new SpatialGrid(l.grid, l.data, STRIDE);
				grids.set(l.grid, grid);
			}
			return {
				zoom: i + d.options.minZoom,
				data: l.data,
				agg: l.agg,
				grid,
			};
		});
	}

	/** Clamp a map zoom to an existing level */
	limitZoom(zoom: number): number {
		return Math.max(this.options.minZoom, Math.min(Math.floor(zoom), this.options.maxZoom + 1));
	}

	/** Level for a map zoom */
	level(zoom: number): ClusterLevel {
		return this.levels[this.limitZoom(zoom) - this.options.minZoom] as ClusterLevel;
	}

	/** Is the row at offset k a cluster? */
	isCluster(data: Int32Array, k: number): boolean {
		return (data[k + OFFSET_ID] as number) >= this.numPoints;
	}

	/**
	 * Push in `out` the rows (offsets in level.data) inside a world bbox
	 */
	range(
		level: ClusterLevel,
		minX: number,
		minY: number,
		maxX: number,
		maxY: number,
		out: number[] = [],
	): number[] {
		const start = out.length;
		level.grid.range(encode(minX), encode(minY), encode(maxX), encode(maxY), out);
		for (let i = start; i < out.length; i++) {
			out[i] = (out[i] as number) * STRIDE;
		}
		return out;
	}

	private originZoom(clusterId: number): number {
		return (clusterId - this.numPoints) % 32;
	}

	private originRow(clusterId: number): number {
		return (clusterId - this.numPoints) >> 5;
	}

	/**
	 * Children of a cluster (clusters or leaves) at the next zoom
	 * @returns the level of the children and their row offsets
	 */
	getChildren(clusterId: number): {
		level: ClusterLevel;
		rows: number[];
	} {
		const errorMsg = `No cluster with the specified id (${clusterId}).`;
		const originZoom = this.originZoom(clusterId);
		const level = this.levels[originZoom - this.options.minZoom];
		if (!level || clusterId < this.numPoints) {
			throw new Error(errorMsg);
		}

		const { data, grid } = level;
		const k0 = this.originRow(clusterId) * STRIDE;
		if (k0 >= data.length) {
			throw new Error(errorMsg);
		}

		const r = levelRadius(this.options, originZoom);
		const ids: number[] = [];
		const count = grid.withinInto(data[k0] as number, data[k0 + 1] as number, r, ids);
		const rows: number[] = [];
		for (let i = 0; i < count; i++) {
			const k = (ids[i] as number) * STRIDE;
			if (data[k + OFFSET_PARENT] === clusterId) {
				rows.push(k);
			}
		}

		if (rows.length === 0) {
			throw new Error(errorMsg);
		}

		return {
			level,
			rows,
		};
	}

	/**
	 * Points (source indices) of a cluster, with pagination
	 */
	getLeaves(clusterId: number, limit: number = Number.POSITIVE_INFINITY, offset = 0): number[] {
		const result: number[] = [];
		this.appendLeaves(result, clusterId, limit, offset, 0);
		return result;
	}

	private appendLeaves(
		result: number[],
		clusterId: number,
		limit: number,
		offset: number,
		skipped: number,
	): number {
		const { level, rows } = this.getChildren(clusterId);
		const { data } = level;
		let skip = skipped;

		for (const k of rows) {
			const num = data[k + OFFSET_NUM] as number;

			if (this.isCluster(data, k)) {
				if (skip + num <= offset) {
					skip += num;
				} else {
					skip = this.appendLeaves(
						result,
						data[k + OFFSET_ID] as number,
						limit,
						offset,
						skip,
					);
				}
			} else {
				for (const p of this.duplicatesOf(data[k + OFFSET_ID] as number)) {
					if (skip < offset) {
						skip++;
					} else if (result.length < limit) {
						result.push(p);
					}
				}
			}

			if (result.length >= limit) {
				break;
			}
		}

		return skip;
	}

	/**
	 * Zoom on which the cluster expands into several children
	 */
	getClusterExpansionZoom(clusterId: number): number {
		let id = clusterId;
		let expansionZoom = this.originZoom(id) - 1;

		while (expansionZoom <= this.options.maxZoom) {
			const { level, rows } = this.getChildren(id);
			expansionZoom++;
			const only = rows[0] as number;
			if (rows.length !== 1 || !this.isCluster(level.data, only)) {
				break;
			}
			id = level.data[only + OFFSET_ID] as number;
		}

		return expansionZoom;
	}

	/**
	 * All the points sharing the position of this point (itself included)
	 */
	duplicatesOf(point: number): number[] {
		const list = [
			point,
		];
		if (this.dupNext) {
			for (let j = this.dupNext[point] as number; j !== -1; j = this.dupNext[j] as number) {
				list.push(j);
			}
		}
		return list;
	}

	/** Find the row of an item (cluster or leaf id) in a level, near an encoded position */
	private findRow(level: ClusterLevel, id: number, x: number, y: number, r: number): number {
		const ids: number[] = [];
		const count = level.grid.withinInto(x, y, r, ids);
		for (let i = 0; i < count; i++) {
			const k = (ids[i] as number) * STRIDE;
			if (level.data[k + OFFSET_ID] === id) {
				return k;
			}
		}
		return -1;
	}

	/**
	 * World position, at a lower zoom, of the item containing the row k of the level `fromZoom`
	 * (used to animate clusters splitting when zooming in)
	 */
	ancestorPosition(
		fromZoom: number,
		k: number,
		toZoom: number,
	):
		| [
				number,
				number,
		  ]
		| null {
		let z = this.limitZoom(fromZoom);
		const target = this.limitZoom(toZoom);
		let level = this.level(z);
		let row = k;

		while (z > target) {
			const up = this.levels[z - 1 - this.options.minZoom];
			if (!up) {
				return null;
			}
			if (up.data === level.data) {
				// plateau: identical levels
				level = up;
				z--;
				continue;
			}

			const data = level.data;
			const parent = data[row + OFFSET_PARENT] as number;
			// carried over unchanged (parent = -1): same id and position in the level above,
			// otherwise the parent centroid is at most 2 radius away
			const id = parent === -1 ? (data[row + OFFSET_ID] as number) : parent;
			const r = parent === -1 ? 1 : 2 * levelRadius(this.options, z);
			const next = this.findRow(up, id, data[row] as number, data[row + 1] as number, r);
			if (next === -1) {
				return null;
			}

			row = next;
			level = up;
			z--;
		}

		return [
			decode(level.data[row] as number),
			decode(level.data[row + 1] as number),
		];
	}
}
