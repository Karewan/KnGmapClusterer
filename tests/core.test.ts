import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { extractAggregates, readAggregates } from "../src/core/aggregate.ts";
import { buildGrid, SpatialGrid } from "../src/core/grid.ts";
import { abbreviateCount, fitZoom, latY, lngX, xLng, yLat } from "../src/core/mercator.ts";
import { simplifiedIndices, simplifyImportance } from "../src/core/simplify.ts";
import { prng } from "./helpers.ts";

describe("mercator", () => {
	test("round trips", () => {
		for (const lng of [
			-180,
			-73.5,
			0,
			2.35,
			179.9,
		]) {
			assert.ok(Math.abs(xLng(lngX(lng)) - lng) < 1e-9);
		}
		for (const lat of [
			-80,
			-33.3,
			0,
			48.85,
			84,
		]) {
			assert.ok(Math.abs(yLat(latY(lat)) - lat) < 1e-9);
		}
		assert.equal(lngX(0), 0.5);
		assert.equal(latY(0), 0.5);
		assert.equal(latY(90), 0);
		assert.equal(latY(-90), 1);
	});

	test("abbreviateCount", () => {
		assert.equal(abbreviateCount(7), "7");
		assert.equal(abbreviateCount(999), "999");
		assert.equal(abbreviateCount(1000), "1k");
		assert.equal(abbreviateCount(1250), "1.3k");
		assert.equal(abbreviateCount(9999), "10k");
		assert.equal(abbreviateCount(25_300), "25k");
		assert.equal(abbreviateCount(2_500_000), "2.5M");
	});

	test("fitZoom", () => {
		// whole world in 256 px => zoom 0
		assert.equal(fitZoom(0, 0, 1, 1, 256, 256, 20), 0);
		assert.equal(fitZoom(0, 0, 0.25, 0.25, 256, 256, 20), 2);
		assert.equal(fitZoom(0.5, 0.5, 0.5, 0.5, 256, 256, 18), 18);
	});
});

describe("SpatialGrid", () => {
	const rnd = prng(1);
	// int32 coordinates (stride 2), with negative values and a few duplicates
	const n = 5000;
	const coords = new Int32Array(n * 2);
	for (let i = 0; i < n; i++) {
		coords[2 * i] = i % 100 === 0 ? 1000 : Math.round((rnd() - 0.5) * 2e6);
		coords[2 * i + 1] = i % 100 === 0 ? -1000 : Math.round((rnd() - 0.5) * 2e6);
	}
	const brute = (pred: (x: number, y: number) => boolean): number[] => {
		const out: number[] = [];
		for (let i = 0; i < n; i++) {
			if (pred(coords[2 * i] as number, coords[2 * i + 1] as number)) {
				out.push(i);
			}
		}
		return out;
	};
	const sorted = (a: number[]): number[] => a.sort((x, y) => x - y);

	for (const cell of [
		1,
		5e3,
		5e4,
		1e7,
	]) {
		const grid = new SpatialGrid(buildGrid(coords, 2, n, cell), coords, 2);

		test(`range (cell ${cell})`, () => {
			for (const [x0, y0, x1, y1] of [
				[
					-2e5,
					-3e5,
					4e5,
					1e5,
				],
				[
					-1e7,
					-1e7,
					1e7,
					1e7,
				],
				[
					1000,
					-1000,
					1000,
					-1000,
				],
			] as const) {
				const out: number[] = [];
				grid.range(x0, y0, x1, y1, out);
				assert.deepEqual(
					sorted(out),
					brute((x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1),
				);
			}
		});

		test(`withinInto (cell ${cell})`, () => {
			const out = new Uint32Array(n);
			for (const r of [
				0,
				1e4,
				3e5,
			]) {
				const count = grid.withinInto(1000, -1000, r, out);
				assert.deepEqual(
					sorted([
						...out.subarray(0, count),
					]),
					brute((x, y) => (x - 1000) ** 2 + (y + 1000) ** 2 <= r * r),
				);
			}
		});
	}

	test("empty grid", () => {
		const empty = new SpatialGrid(buildGrid(new Int32Array(0), 2, 0, 10), new Int32Array(0), 2);
		const out: number[] = [];
		empty.range(0, 0, 1, 1, out);
		assert.deepEqual(out, []);
		assert.equal(empty.withinInto(0, 0, 1, []), 0);
	});
});

describe("aggregates", () => {
	test("extract and read", () => {
		const points = [
			{
				v: 1,
				t: "a",
			},
			{
				v: 5,
				t: "b",
			},
			{
				v: 3,
				t: "a",
			},
		];
		const { plan, values } = extractAggregates(
			points,
			[
				0,
				1,
				2,
			],
			{
				sum: {
					sum: "v",
				},
				max: {
					max: "v",
				},
				avg: {
					avg: "v",
				},
				t: {
					countBy: "t",
				},
			},
		);
		assert.equal(plan.cols, 5);
		assert.deepEqual(
			[
				...values.subarray(0, 5),
			],
			[
				1,
				1,
				1,
				1,
				0,
			],
		);

		// merge the 3 rows manually
		const merged = Float64Array.from(values.subarray(0, 5));
		for (const r of [
			1,
			2,
		]) {
			for (let c = 0; c < 5; c++) {
				const a = merged[c] as number;
				const b = values[r * 5 + c] as number;
				merged[c] =
					plan.ops[c] === 2 ? Math.max(a, b) : plan.ops[c] === 1 ? Math.min(a, b) : a + b;
			}
		}
		assert.deepEqual(readAggregates(plan, merged, 0, 3), {
			sum: 9,
			max: 5,
			avg: 3,
			t: {
				a: 2,
				b: 1,
			},
		});
	});
});

describe("simplify", () => {
	test("keeps the extremities and removes collinear points", () => {
		const xs = Float64Array.from([
			0,
			1,
			2,
			3,
			4,
		]);
		const ys = Float64Array.from([
			0,
			0,
			0,
			0,
			0,
		]);
		const imp = simplifyImportance(xs, ys);
		assert.deepEqual(
			simplifiedIndices(imp, 1e-9),
			[
				0,
				4,
			],
		);
	});

	test("is monotonic with the tolerance", () => {
		const rnd = prng(3);
		const n = 2000;
		const xs = new Float64Array(n);
		const ys = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			xs[i] = i / n;
			ys[i] = Math.sin(i / 50) * 0.1 + rnd() * 0.01;
		}
		const imp = simplifyImportance(xs, ys);
		let prev = n + 1;
		for (const tol of [
			0,
			1e-4,
			1e-3,
			1e-2,
			1e-1,
		]) {
			const kept = simplifiedIndices(imp, tol);
			assert.ok(kept.length <= prev);
			assert.equal(kept[0], 0);
			assert.equal(kept.at(-1), n - 1);
			prev = kept.length;
		}
		assert.equal(simplifiedIndices(imp, 0).length, n);
	});
});
