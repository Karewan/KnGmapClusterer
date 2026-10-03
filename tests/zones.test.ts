import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { concaveHull, convexHull } from "../src/core/concave-hull.ts";
import { latY, lngX } from "../src/core/mercator.ts";
import { pointInRing, poleOfInaccessibility } from "../src/core/polygon.ts";
import { buildZones, insideZone, unpackZones } from "../src/core/zones.ts";
import { prng } from "./helpers.ts";

function world(
	points: [
		number,
		number,
	][],
): {
	xs: Float64Array;
	ys: Float64Array;
} {
	return {
		xs: Float64Array.from(points, (p) => lngX(p[0])),
		ys: Float64Array.from(points, (p) => latY(p[1])),
	};
}

function area(xs: Float64Array, ys: Float64Array, ring: number[]): number {
	let a = 0;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const p = ring[i] as number;
		const q = ring[j] as number;
		a += ((xs[q] as number) - (xs[p] as number)) * ((ys[q] as number) + (ys[p] as number));
	}
	return Math.abs(a / 2);
}

/** Proper intersection of two segments */
function crosses(
	ax: number,
	ay: number,
	bx: number,
	by: number,
	cx: number,
	cy: number,
	dx: number,
	dy: number,
): boolean {
	const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) =>
		Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
	return (
		o(ax, ay, bx, by, cx, cy) * o(ax, ay, bx, by, dx, dy) < 0 &&
		o(cx, cy, dx, dy, ax, ay) * o(cx, cy, dx, dy, bx, by) < 0
	);
}

function isSimple(xs: Float64Array, ys: Float64Array, ring: number[]): boolean {
	const n = ring.length;
	for (let i = 0; i < n; i++) {
		for (let j = i + 2; j < n; j++) {
			if (i === 0 && j === n - 1) {
				continue;
			}
			const a = ring[i] as number;
			const b = ring[(i + 1) % n] as number;
			const c = ring[j] as number;
			const d = ring[(j + 1) % n] as number;
			if (
				crosses(
					xs[a] as number,
					ys[a] as number,
					xs[b] as number,
					ys[b] as number,
					xs[c] as number,
					ys[c] as number,
					xs[d] as number,
					ys[d] as number,
				)
			) {
				return false;
			}
		}
	}
	return true;
}

/** L shaped set of points: the empty corner must not be in the outline */
function lShape(count: number): [
	number,
	number,
][] {
	const rnd = prng(5);
	const out: [
		number,
		number,
	][] = [];
	for (let i = 0; i < count; i++) {
		if (i % 2 === 0) {
			// horizontal bar: x in [0, 1], y in [0, 0.2]
			out.push([
				2 + rnd(),
				48 + rnd() * 0.2,
			]);
		} else {
			// vertical bar: x in [0, 0.2], y in [0, 1]
			out.push([
				2 + rnd() * 0.2,
				48 + rnd(),
			]);
		}
	}
	return out;
}

describe("concave hull", () => {
	const pts = lShape(600);
	const { xs, ys } = world(pts);
	const all = pts.map((_, i) => i);
	const hull = concaveHull(xs, ys, all);
	const convex = convexHull(xs, ys, all);

	test("passes through actual points and is a simple polygon", () => {
		assert.ok(hull.length >= convex.length);
		for (const p of hull) {
			assert.ok(p >= 0 && p < pts.length);
		}
		assert.equal(new Set(hull).size, hull.length);
		assert.ok(isSimple(xs, ys, hull));
	});

	test("every point is inside or on the outline", () => {
		const onRing = new Set(hull);
		for (let i = 0; i < pts.length; i++) {
			if (onRing.has(i)) {
				continue;
			}
			// tiny tolerance for the points exactly on an edge
			const x = xs[i] as number;
			const y = ys[i] as number;
			const e = 1e-12;
			const inside =
				pointInRing(xs, ys, hull, x, y) ||
				pointInRing(xs, ys, hull, x + e, y) ||
				pointInRing(xs, ys, hull, x - e, y) ||
				pointInRing(xs, ys, hull, x, y + e) ||
				pointInRing(xs, ys, hull, x, y - e);
			assert.ok(inside, `point ${i} outside`);
		}
	});

	test("follows the shape: the empty corner of the L is outside", () => {
		assert.ok(area(xs, ys, hull) < area(xs, ys, convex) * 0.7);
		// the empty corner (x = 0.5, y = 0.5 of the L) is in the convex hull, not in the concave one
		const cx = lngX(2.5);
		const cy = latY(48.5);
		assert.ok(pointInRing(xs, ys, convex, cx, cy));
		assert.ok(!pointInRing(xs, ys, hull, cx, cy));
	});

	test("concavity Infinity gives the convex hull", () => {
		assert.deepEqual(concaveHull(xs, ys, all, Number.POSITIVE_INFINITY), convex);
	});

	test("label inside, even for a L", () => {
		const [lx, ly] = poleOfInaccessibility(xs, ys, hull);
		assert.ok(pointInRing(xs, ys, hull, lx, ly));
	});

	test("big set", () => {
		const rnd = prng(9);
		const many: [
			number,
			number,
		][] = Array.from(
			{
				length: 20_000,
			},
			() => {
				const a = rnd() * Math.PI * 2;
				// ring shaped set
				const r = 0.5 + rnd() * 0.2;
				return [
					5 + Math.cos(a) * r,
					45 + Math.sin(a) * r,
				];
			},
		);
		const w = world(many);
		const t = performance.now();
		const ring = concaveHull(
			w.xs,
			w.ys,
			many.map((_, i) => i),
		);
		const ms = performance.now() - t;
		assert.ok(ring.length > 20);
		assert.ok(ms < 2000, `${ms} ms`);
	});
});

describe("zones", () => {
	test("degenerated groups (1 or 2 points)", () => {
		const { xs, ys } = world([
			[
				1,
				45,
			],
			[
				2,
				45,
			],
			[
				3,
				45,
			],
		]);
		const zones = unpackZones(
			buildZones(
				xs,
				ys,
				Int32Array.from([
					0,
					1,
					1,
				]),
				2,
			),
		);
		assert.equal(zones[0]?.ring.length, 1);
		assert.equal(zones[1]?.ring.length, 2);
		assert.ok(!insideZone(xs, ys, zones[1] as never, xs[1] as number, ys[1] as number));
		// label between the two points
		assert.ok(Math.abs((zones[1]?.labelX as number) - lngX(2.5)) < 1e-9);
	});

	test("pack / unpack and hit test", () => {
		const pts = lShape(200);
		const { xs, ys } = world(pts);
		const groups = new Int32Array(pts.length).fill(0);
		const [zone] = unpackZones(buildZones(xs, ys, groups, 1));
		assert.ok(zone);
		assert.ok(insideZone(xs, ys, zone, zone.labelX, zone.labelY));
		assert.ok(!insideZone(xs, ys, zone, lngX(2.5), latY(48.5)));
	});
});
