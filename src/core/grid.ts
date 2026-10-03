/**
 * Hashed uniform grid spatial index on int32 coordinates.
 *
 * Replaces a KD-tree (kdbush): building is O(n) instead of O(n log n) and, with a cell size equal
 * to the query radius, a radius query only visits 3x3 cells. About 25% faster than kdbush for the
 * clustering, where an index is built and queried for every zoom level.
 *
 * Only the non empty cells are stored, in an open addressing hash table.
 * Everything lives in typed arrays: transferable from a worker without copy.
 */

const EMPTY = -2147483648;

/** Plain, transferable, representation of a grid */
export interface GridData {
	/** cell size (int32 coordinates units) */
	readonly cell: number;
	/** number of indexed items */
	readonly numItems: number;
	/** hash table: cell x, cell y (EMPTY = free slot), cell index */
	readonly keysX: Int32Array;
	readonly keysY: Int32Array;
	readonly slots: Int32Array;
	/** items of cell c: items[start[c] .. start[c + 1]] */
	readonly start: Uint32Array;
	readonly items: Uint32Array;
}

function hash(gx: number, gy: number): number {
	return (Math.imul(gx, 0x9e3779b1) ^ Math.imul(gy, 0x85ebca77)) >>> 0;
}

function tableSize(n: number): number {
	let size = 16;
	while (size < n * 2) {
		size *= 2;
	}
	return size;
}

/**
 * Build a grid
 * @param coords item coordinates: x at coords[i * stride], y at coords[i * stride + 1]
 */
export function buildGrid(
	coords: Int32Array,
	stride: number,
	numItems: number,
	cellSize: number,
): GridData {
	const cell = Math.max(1, cellSize);
	const n = numItems;

	// 1. distinct cells (temporary table sized for the worst case: one cell per item)
	let size = tableSize(n);
	let mask = size - 1;
	let keysX = new Int32Array(size).fill(EMPTY);
	let keysY = new Int32Array(size);
	let slots = new Int32Array(size);
	const cellOf = new Uint32Array(n);
	const cellX = new Int32Array(n);
	const cellY = new Int32Array(n);
	const counts = new Uint32Array(n + 1);
	let cells = 0;

	for (let i = 0; i < n; i++) {
		const gx = Math.floor((coords[i * stride] as number) / cell);
		const gy = Math.floor((coords[i * stride + 1] as number) / cell);
		let h = hash(gx, gy) & mask;
		while (keysX[h] !== EMPTY && (keysX[h] !== gx || keysY[h] !== gy)) {
			h = (h + 1) & mask;
		}
		if (keysX[h] === EMPTY) {
			keysX[h] = gx;
			keysY[h] = gy;
			slots[h] = cells;
			cellX[cells] = gx;
			cellY[cells] = gy;
			cells++;
		}
		const c = slots[h] as number;
		cellOf[i] = c;
		counts[c] = (counts[c] as number) + 1;
	}

	// 2. compact table sized for the actual number of cells
	if (tableSize(cells) < size) {
		size = tableSize(cells);
		mask = size - 1;
		keysX = new Int32Array(size).fill(EMPTY);
		keysY = new Int32Array(size);
		slots = new Int32Array(size);
		for (let c = 0; c < cells; c++) {
			const gx = cellX[c] as number;
			const gy = cellY[c] as number;
			let h = hash(gx, gy) & mask;
			while (keysX[h] !== EMPTY) {
				h = (h + 1) & mask;
			}
			keysX[h] = gx;
			keysY[h] = gy;
			slots[h] = c;
		}
	}

	// 3. items grouped by cell (counting sort)
	const start = new Uint32Array(cells + 1);
	for (let c = 0; c < cells; c++) {
		start[c + 1] = (start[c] as number) + (counts[c] as number);
	}
	const fill = start.slice(0, cells);
	const items = new Uint32Array(n);
	for (let i = 0; i < n; i++) {
		const c = cellOf[i] as number;
		items[fill[c] as number] = i;
		fill[c] = (fill[c] as number) + 1;
	}

	return {
		cell,
		numItems: n,
		keysX,
		keysY,
		slots,
		start,
		items,
	};
}

/** ArrayBuffers of a grid (to transfer it) */
export function gridBuffers(g: GridData): ArrayBuffer[] {
	return [
		g.keysX,
		g.keysY,
		g.slots,
		g.start,
		g.items,
	].map((a) => a.buffer as ArrayBuffer);
}

/**
 * Query side of a grid
 */
export class SpatialGrid {
	readonly g: GridData;
	private readonly coords: Int32Array;
	private readonly stride: number;
	private readonly mask: number;

	constructor(g: GridData, coords: Int32Array, stride: number) {
		this.g = g;
		this.coords = coords;
		this.stride = stride;
		this.mask = g.keysX.length - 1;
	}

	get numItems(): number {
		return this.g.numItems;
	}

	/** Index of a cell, -1 if empty */
	private find(gx: number, gy: number): number {
		const { keysX, keysY, slots } = this.g;
		let h = hash(gx, gy) & this.mask;
		while (keysX[h] !== EMPTY) {
			if (keysX[h] === gx && keysY[h] === gy) {
				return slots[h] as number;
			}
			h = (h + 1) & this.mask;
		}
		return -1;
	}

	/**
	 * Push in `out` the items inside a bounding box
	 */
	range(minX: number, minY: number, maxX: number, maxY: number, out: number[]): void {
		const { cell, start, items } = this.g;
		const coords = this.coords;
		const s = this.stride;
		const gx0 = Math.floor(minX / cell);
		const gx1 = Math.floor(maxX / cell);
		const gy0 = Math.floor(minY / cell);
		const gy1 = Math.floor(maxY / cell);

		// more cells to visit than items: scanning the items is cheaper
		if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > this.g.numItems) {
			for (let i = 0; i < this.g.numItems; i++) {
				const x = coords[i * s] as number;
				const y = coords[i * s + 1] as number;
				if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
					out.push(i);
				}
			}
			return;
		}

		for (let gy = gy0; gy <= gy1; gy++) {
			for (let gx = gx0; gx <= gx1; gx++) {
				const c = this.find(gx, gy);
				if (c < 0) {
					continue;
				}
				const inner = gx > gx0 && gx < gx1 && gy > gy0 && gy < gy1;
				const end = start[c + 1] as number;
				for (let j = start[c] as number; j < end; j++) {
					const i = items[j] as number;
					if (inner) {
						out.push(i);
						continue;
					}
					const x = coords[i * s] as number;
					const y = coords[i * s + 1] as number;
					if (x >= minX && x <= maxX && y >= minY && y <= maxY) {
						out.push(i);
					}
				}
			}
		}
	}

	/**
	 * Write in `out` the items within a radius
	 * @returns the number of items written
	 */
	withinInto(qx: number, qy: number, r: number, out: Uint32Array | number[]): number {
		const { cell, start, items } = this.g;
		const coords = this.coords;
		const s = this.stride;
		const r2 = r * r;
		const gx0 = Math.floor((qx - r) / cell);
		const gx1 = Math.floor((qx + r) / cell);
		const gy0 = Math.floor((qy - r) / cell);
		const gy1 = Math.floor((qy + r) / cell);
		let count = 0;

		// more cells to visit than items: scanning the items is cheaper
		if ((gx1 - gx0 + 1) * (gy1 - gy0 + 1) > this.g.numItems) {
			for (let i = 0; i < this.g.numItems; i++) {
				const dx = (coords[i * s] as number) - qx;
				const dy = (coords[i * s + 1] as number) - qy;
				if (dx * dx + dy * dy <= r2) {
					out[count++] = i;
				}
			}
			return count;
		}

		for (let gy = gy0; gy <= gy1; gy++) {
			for (let gx = gx0; gx <= gx1; gx++) {
				const c = this.find(gx, gy);
				if (c < 0) {
					continue;
				}
				const end = start[c + 1] as number;
				for (let j = start[c] as number; j < end; j++) {
					const i = items[j] as number;
					const dx = (coords[i * s] as number) - qx;
					const dy = (coords[i * s + 1] as number) - qy;
					if (dx * dx + dy * dy <= r2) {
						out[count++] = i;
					}
				}
			}
		}

		return count;
	}
}
