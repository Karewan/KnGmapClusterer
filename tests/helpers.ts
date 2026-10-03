import type { ClusterIndexOptions } from "../src/core/cluster-index.ts";

export interface TestPoint {
	x: number;
	y: number;
	type: "a" | "b" | "c";
	value: number;
}

export const FIXTURE_OPTIONS: ClusterIndexOptions = {
	minZoom: 0,
	maxZoom: 16,
	minPoints: 2,
	radius: 60,
	extent: 256,
	groupDuplicates: false,
};

/** Deterministic pseudo random generator (mulberry32) */
export function prng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** 3000 points around a few "cities", plus some uniform noise */
export function fixturePoints(count = 3000, seed = 42): TestPoint[] {
	const rnd = prng(seed);
	const centers: [
		number,
		number,
	][] = [
		[
			2.35,
			48.85,
		],
		[
			4.83,
			45.76,
		],
		[
			5.37,
			43.29,
		],
		[
			-0.57,
			44.83,
		],
		[
			-73.98,
			40.75,
		],
		[
			139.69,
			35.68,
		],
	];
	const types = [
		"a",
		"b",
		"c",
	] as const;
	const points: TestPoint[] = [];

	for (let i = 0; i < count; i++) {
		const type = types[i % 3] as "a" | "b" | "c";
		const value = Math.round(rnd() * 100);
		if (i % 10 === 0) {
			points.push({
				x: rnd() * 360 - 180,
				y: rnd() * 160 - 80,
				type,
				value,
			});
		} else {
			const c = centers[i % centers.length] as [
				number,
				number,
			];
			const spread = rnd() < 0.5 ? 0.05 : 1.5;
			points.push({
				x: c[0] + (rnd() - 0.5) * spread,
				y: c[1] + (rnd() - 0.5) * spread,
				type,
				value,
			});
		}
	}

	return points;
}
