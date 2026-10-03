import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { extractAggregates } from "../src/core/aggregate.ts";
import {
	buildClusterIndex,
	ClusterIndex,
	decode,
	OFFSET_ID,
	OFFSET_NUM,
	STRIDE,
} from "../src/core/cluster-index.ts";
import { latY, lngX } from "../src/core/mercator.ts";
import { FIXTURE_OPTIONS, fixturePoints, type TestPoint } from "./helpers.ts";

interface FixtureCluster {
	id: number;
	count: number;
	lng: number;
	lat: number;
	expansionZoom: number;
	leaves: number[];
}

interface FixtureZoom {
	zoom: number;
	items: (
		| FixtureCluster
		| {
				point: number;
		  }
	)[];
}

const fixtures = JSON.parse(
	readFileSync(new URL("./fixtures/supercluster.json", import.meta.url), "utf8"),
) as {
	zooms: FixtureZoom[];
};

function build(points: TestPoint[], groupDuplicates = false): ClusterIndex {
	const rows = points.map((_, i) => i);
	const { plan, values } = extractAggregates(points, rows, {
		total: {
			sum: "value",
		},
		biggest: {
			max: "value",
		},
		types: {
			countBy: "type",
		},
	});
	const data = buildClusterIndex(
		{
			xs: Float64Array.from(points, (p) => lngX(p.x)),
			ys: Float64Array.from(points, (p) => latY(p.y)),
			agg: values,
			ops: plan.ops,
		},
		{
			...FIXTURE_OPTIONS,
			groupDuplicates,
		},
	);
	return new ClusterIndex(data);
}

describe("ClusterIndex", () => {
	const points = fixturePoints();
	const index = build(points);

	test("matches supercluster on every zoom", () => {
		for (const { zoom, items } of fixtures.zooms) {
			const level = index.level(zoom);
			const rows = index.range(level, 0, 0, 1, 1);
			assert.equal(rows.length, items.length, `number of items at zoom ${zoom}`);

			const ours = new Map<number, number>();
			for (const k of rows) {
				ours.set(level.data[k + OFFSET_ID] as number, k);
			}

			for (const item of items) {
				if ("point" in item) {
					assert.ok(ours.has(item.point), `point ${item.point} at zoom ${zoom}`);
					continue;
				}

				const k = ours.get(item.id);
				assert.ok(k !== undefined, `cluster ${item.id} at zoom ${zoom}`);
				assert.equal(level.data[k + OFFSET_NUM], item.count);
				assert.ok(Math.abs(decode(level.data[k] as number) - lngX(item.lng)) < 1e-9);
				assert.ok(Math.abs(decode(level.data[k + 1] as number) - latY(item.lat)) < 1e-9);
				assert.equal(index.getClusterExpansionZoom(item.id), item.expansionZoom);
				assert.deepEqual(
					index.getLeaves(item.id).sort((a, b) => a - b),
					item.leaves,
				);
			}
		}
	});

	test("aggregates are merged in clusters", () => {
		const level = index.level(0);
		const rows = index.range(level, 0, 0, 1, 1);
		let total = 0;
		let count = 0;
		for (const k of rows) {
			total += level.agg[(k / STRIDE) * 5] as number;
			count += level.data[k + OFFSET_NUM] as number;
		}
		assert.equal(count, points.length);
		assert.equal(
			total,
			points.reduce((s, p) => s + p.value, 0),
		);
	});

	test("getLeaves returns every point once", () => {
		const level = index.level(0);
		const all: number[] = [];
		for (const k of index.range(level, 0, 0, 1, 1)) {
			const id = level.data[k + OFFSET_ID] as number;
			if (index.isCluster(level.data, k)) {
				all.push(...index.getLeaves(id));
			} else {
				all.push(id);
			}
		}
		assert.equal(new Set(all).size, points.length);
	});

	test("groups exact duplicates in a weighted leaf", () => {
		const dup: TestPoint[] = [
			{
				x: 2,
				y: 48,
				type: "a",
				value: 1,
			},
			{
				x: 2,
				y: 48,
				type: "b",
				value: 2,
			},
			{
				x: 2,
				y: 48,
				type: "a",
				value: 3,
			},
			{
				x: 100,
				y: -30,
				type: "c",
				value: 4,
			},
		];
		const idx = build(dup, true);
		const leaves = idx.level(17);
		const rows = idx.range(leaves, 0, 0, 1, 1);
		assert.equal(rows.length, 2);

		const leader = rows.find((k) => leaves.data[k + OFFSET_NUM] === 3);
		assert.ok(leader !== undefined);
		assert.equal(leaves.data[leader + OFFSET_ID], 0);
		assert.deepEqual(
			idx.duplicatesOf(0),
			[
				0,
				1,
				2,
			],
		);
		// sum of "value" of the group
		assert.equal(leaves.agg[(leader / STRIDE) * 5], 6);
	});

	test("ancestorPosition finds the parent cluster", () => {
		const z = 5;
		const level = index.level(z + 1);
		const parentLevel = index.level(z);
		const parents = new Set(
			index.range(parentLevel, 0, 0, 1, 1).map((k) => {
				return `${decode(parentLevel.data[k] as number)},${decode(parentLevel.data[k + 1] as number)}`;
			}),
		);
		for (const k of index.range(level, 0, 0, 1, 1).slice(0, 50)) {
			const pos = index.ancestorPosition(z + 1, k, z);
			assert.ok(pos);
			assert.ok(parents.has(`${pos[0]},${pos[1]}`));
		}
	});
});
