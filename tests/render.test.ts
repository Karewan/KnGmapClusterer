import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseColor } from "../src/render/color.ts";
import { InstanceBuffer, writePos } from "../src/render/gl/instances.ts";
import { SPRITE } from "../src/render/gl/layouts.ts";
import { HitList } from "../src/render/hits.ts";
import { spiderOffsets } from "../src/render/spider.ts";
import { createView, queryBoxes, toScreen } from "../src/render/view.ts";

const rgba = (c: number): number[] => [
	c & 255,
	(c >>> 8) & 255,
	(c >>> 16) & 255,
	c >>> 24,
];

describe("parseColor", () => {
	test("hex", () => {
		assert.deepEqual(
			rgba(parseColor("#ff8000")),
			[
				255,
				128,
				0,
				255,
			],
		);
		assert.deepEqual(
			rgba(parseColor("#f80")),
			[
				255,
				136,
				0,
				255,
			],
		);
		assert.deepEqual(
			rgba(parseColor("#ff800080")),
			[
				255,
				128,
				0,
				128,
			],
		);
	});

	test("rgb / rgba", () => {
		assert.deepEqual(
			rgba(parseColor("rgb(1, 2, 3)")),
			[
				1,
				2,
				3,
				255,
			],
		);
		assert.deepEqual(
			rgba(parseColor("rgba(10,20,30,0.5)")),
			[
				10,
				20,
				30,
				128,
			],
		);
		assert.deepEqual(
			rgba(parseColor("rgb(10 20 30 / 50%)")),
			[
				10,
				20,
				30,
				128,
			],
		);
	});

	test("transparent and invalid", () => {
		assert.equal(parseColor("transparent"), 0);
		// no canvas under Node: invalid colors are opaque black
		assert.deepEqual(
			rgba(parseColor("not-a-color")),
			[
				0,
				0,
				0,
				255,
			],
		);
	});
});

describe("InstanceBuffer", () => {
	test("grows and keeps the data", () => {
		const buf = new InstanceBuffer(SPRITE, 2);
		for (let i = 0; i < 100; i++) {
			const o = buf.push();
			buf.f32[o] = i;
		}
		assert.equal(buf.count, 100);
		assert.ok(buf.capacity >= 100);
		assert.equal(buf.f32[99 * SPRITE.stride], 99);
		const v = buf.version;
		buf.clear();
		assert.equal(buf.count, 0);
		assert.ok(buf.version > v);
	});

	test("writePos splits in high + low float32 parts", () => {
		const f = new Float32Array(4);
		const x = 0.123456789012345;
		writePos(f, 0, x, 0.5);
		assert.ok(Math.abs((f[0] as number) + (f[2] as number) - x) < 1e-15);
		assert.equal(f[1], 0.5);
		assert.equal(f[3], 0);
	});
});

describe("view", () => {
	test("world copies when the view spans the antimeridian", () => {
		// centered on x = 1 (lng 180) at zoom 2: 1024 px world, 800 px view
		const view = createView(2, 1, 0.5, 800, 600, 1, 0);
		assert.deepEqual(
			view.worldOffsets,
			[
				0,
				1,
			],
		);
		const boxes = queryBoxes(view, 0);
		assert.equal(boxes.length, 2);
		assert.deepEqual(boxes[0]?.[2], 1);
		assert.deepEqual(boxes[1]?.[0], 0);
	});

	test("toScreen picks the nearest world copy", () => {
		const view = createView(2, 0.99, 0.5, 800, 600, 1, 0);
		const [x] = toScreen(view, 0.01, 0.5);
		assert.ok(Math.abs(x - 0.02 * 1024) < 1e-9);
	});
});

describe("HitList", () => {
	test("returns the top-most item under the pointer", () => {
		const view = createView(10, 0.5, 0.5, 800, 600, 1, 0);
		const hits = new HitList();
		hits.add(0.5, 0.5, -10, -10, 10, 10, 0, 1);
		hits.add(0.5, 0.5, -5, -5, 5, 5, 0, 2);
		const px = 1 / view.scale;
		assert.equal(hits.ref(hits.find(view, 0.5, 0.5)), 2);
		assert.equal(hits.ref(hits.find(view, 0.5 + 8 * px, 0.5)), 1);
		assert.equal(hits.find(view, 0.5 + 20 * px, 0.5), -1);
	});
});

describe("spiderOffsets", () => {
	test("markers do not overlap", () => {
		for (const n of [
			2,
			5,
			9,
			10,
			50,
		]) {
			const o = spiderOffsets(n, 44);
			for (let i = 0; i < n; i++) {
				for (let j = i + 1; j < n; j++) {
					const d = Math.hypot(
						(o[2 * i] as number) - (o[2 * j] as number),
						(o[2 * i + 1] as number) - (o[2 * j + 1] as number),
					);
					assert.ok(d > 25, `${n} markers: ${i} and ${j} too close (${d})`);
				}
			}
		}
	});
});
