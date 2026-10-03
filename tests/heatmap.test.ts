import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { aggregateHeat, maxHeat } from "../src/core/heatmap.ts";
import { latY, lngX } from "../src/core/mercator.ts";
import { prng } from "./helpers.ts";

describe("heatmap", () => {
	const rnd = prng(4);
	const n = 5000;
	const xs = new Float64Array(n);
	const ys = new Float64Array(n);
	const ws = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		xs[i] = lngX(2 + rnd());
		ys[i] = latY(48 + rnd());
		ws[i] = i % 10 === 0 ? 0 : rnd() * 10;
	}

	test("the aggregation keeps the sum of the weights", () => {
		const cells = aggregateHeat(xs, ys, ws, 1e-4);
		const total = ws.reduce((s, w) => s + w, 0);
		const sum = cells.w.reduce((s, w) => s + w, 0);
		assert.ok(Math.abs(sum - total) < 1e-6 * total);
		assert.ok(cells.count < n);
		for (const w of cells.w) {
			assert.ok(w > 0);
		}
	});

	test("max aggregation keeps the strongest point of each cell", () => {
		const cells = aggregateHeat(xs, ys, ws, 1e-4, "max");
		const strongest = ws.reduce((m, w) => Math.max(m, w), 0);
		assert.equal(maxHeat(cells, 1e-3, "max"), strongest);
		assert.ok(cells.count < n);
		for (let i = 0; i < cells.count; i++) {
			// at the exact position of a point that has this weight
			const j = ws.indexOf(cells.w[i] as number);
			assert.ok(j >= 0);
			assert.equal(xs[j], cells.x[i]);
			assert.equal(ys[j], cells.y[i]);
		}
		// the strongest values do not add up
		const same = aggregateHeat(
			Float64Array.from([
				0.5,
				0.5,
			]),
			Float64Array.from([
				0.5,
				0.5,
			]),
			Float64Array.from([
				3,
				2,
			]),
			1e-6,
			"max",
		);
		assert.equal(maxHeat(same, 1e-4, "max"), 3);
	});

	test("bigger cells, fewer splats", () => {
		const small = aggregateHeat(xs, ys, ws, 1e-5);
		const big = aggregateHeat(xs, ys, ws, 1e-3);
		assert.ok(big.count < small.count);
	});

	test("max density", () => {
		const one = aggregateHeat(
			Float64Array.from([
				0.5,
			]),
			Float64Array.from([
				0.5,
			]),
			Float64Array.from([
				3,
			]),
			1e-6,
		);
		assert.ok(Math.abs(maxHeat(one, 1e-4) - 3) < 1e-9);

		// two points at the same place: the densities add up
		const two = aggregateHeat(
			Float64Array.from([
				0.5,
				0.5,
			]),
			Float64Array.from([
				0.5,
				0.5,
			]),
			Float64Array.from([
				3,
				2,
			]),
			1e-6,
		);
		assert.ok(Math.abs(maxHeat(two, 1e-4) - 5) < 1e-9);

		// far apart points do not add up
		const far = aggregateHeat(
			Float64Array.from([
				0.5,
				0.6,
			]),
			Float64Array.from([
				0.5,
				0.5,
			]),
			Float64Array.from([
				3,
				2,
			]),
			1e-6,
		);
		assert.ok(Math.abs(maxHeat(far, 1e-4) - 3) < 1e-9);
	});
});
