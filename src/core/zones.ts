/**
 * Zones: exact outer perimeter (concave hull) of groups of points.
 * The outline passes through the outermost points of each group: no margin, no approximation.
 */

import { concaveHull } from "./concave-hull.ts";
import { pointInRing, poleOfInaccessibility } from "./polygon.ts";

export interface ZoneHullOptions {
	/** 1 = very concave (follows the points closely), Infinity = convex hull (default 2) */
	readonly concavity: number;
}

export const DEFAULT_ZONE_OPTIONS: ZoneHullOptions = {
	concavity: 2,
};

/** Zones of all the groups, packed in transferable arrays */
export interface PackedZones {
	/** point indices of the rings of every group, concatenated */
	readonly rings: Uint32Array;
	/** offset of the ring of each group in `rings` (count + 1 values) */
	readonly offsets: Uint32Array;
	/** world position of the label of each group (x, y) */
	readonly labels: Float64Array;
}

export interface ZoneShape {
	/** point indices of the outline (closed implicitly). < 3 points: degenerated zone */
	readonly ring: Uint32Array;
	/** world position of the label */
	readonly labelX: number;
	readonly labelY: number;
}

/**
 * Compute the outline of every group
 * @param groups group index of each point (-1: no group)
 */
export function buildZones(
	xs: Float64Array,
	ys: Float64Array,
	groups: Int32Array,
	count: number,
	opts: ZoneHullOptions = DEFAULT_ZONE_OPTIONS,
): PackedZones {
	const members: number[][] = Array.from(
		{
			length: count,
		},
		() => [],
	);
	for (let i = 0; i < groups.length; i++) {
		const g = groups[i] as number;
		if (g >= 0 && g < count) {
			(members[g] as number[]).push(i);
		}
	}

	const rings = members.map((m) => concaveHull(xs, ys, m, opts.concavity));
	const offsets = new Uint32Array(count + 1);
	for (let g = 0; g < count; g++) {
		offsets[g + 1] = (offsets[g] as number) + (rings[g] as number[]).length;
	}
	const flat = new Uint32Array(offsets[count] as number);
	const labels = new Float64Array(count * 2);

	rings.forEach((ring, g) => {
		flat.set(ring, offsets[g] as number);
		let lx: number;
		let ly: number;
		if (ring.length >= 3) {
			[lx, ly] = poleOfInaccessibility(xs, ys, ring);
		} else {
			// degenerated zone: center of its points
			const m = members[g] as number[];
			lx = m.reduce((s, i) => s + (xs[i] as number), 0) / Math.max(1, m.length);
			ly = m.reduce((s, i) => s + (ys[i] as number), 0) / Math.max(1, m.length);
		}
		labels[2 * g] = lx;
		labels[2 * g + 1] = ly;
	});

	return {
		rings: flat,
		offsets,
		labels,
	};
}

/** Unpack the zones (views on the packed arrays, no copy) */
export function unpackZones(p: PackedZones): ZoneShape[] {
	const count = p.offsets.length - 1;
	const out: ZoneShape[] = [];
	for (let g = 0; g < count; g++) {
		out.push({
			ring: p.rings.subarray(p.offsets[g] as number, p.offsets[g + 1] as number),
			labelX: p.labels[2 * g] as number,
			labelY: p.labels[2 * g + 1] as number,
		});
	}
	return out;
}

/** Is a world position inside the zone? */
export function insideZone(
	xs: Float64Array,
	ys: Float64Array,
	z: ZoneShape,
	x: number,
	y: number,
): boolean {
	return z.ring.length >= 3 && pointInRing(xs, ys, z.ring, x, y);
}
