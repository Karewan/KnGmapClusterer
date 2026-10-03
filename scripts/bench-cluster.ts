/**
 * Index build benchmark (Node).
 *   node --experimental-strip-types scripts/bench-cluster.ts [path/to/supercluster/index.js]
 * When a supercluster path is given, it is benchmarked too for comparison.
 * Runs are interleaved after a warmup so that both get the same JIT state.
 */

import { pathToFileURL } from "node:url";
import { buildClusterIndex, type ClusterIndexOptions } from "../src/core/cluster-index.ts";
import { latY, lngX } from "../src/core/mercator.ts";
import { fixturePoints, type TestPoint } from "../tests/helpers.ts";

interface ScIndex {
	load(points: unknown[]): unknown;
}
type ScCtor = new (opts: Record<string, unknown>) => ScIndex;

const base = {
	minZoom: 0,
	maxZoom: 16,
	minPoints: 2,
	radius: 60,
	extent: 256,
	nodeSize: 64,
	groupDuplicates: false,
};

const scPath = process.argv[2];
const Supercluster = scPath
	? (
			(await import(pathToFileURL(scPath).href)) as {
				default: ScCtor;
			}
		).default
	: null;

function median(values: number[]): number {
	const s = [
		...values,
	].sort((a, b) => a - b);
	return s[s.length >> 1] as number;
}

function kn(points: TestPoint[]): void {
	const n = points.length;
	const xs = new Float64Array(n);
	const ys = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const p = points[i] as TestPoint;
		xs[i] = lngX(p.x);
		ys[i] = latY(p.y);
	}
	const { nodeSize: _, ...rest } = base;
	const options: ClusterIndexOptions = rest;
	buildClusterIndex(
		{
			xs,
			ys,
			agg: new Float64Array(0),
			ops: new Uint8Array(0),
		},
		options,
	);
}

function time(fn: () => void): number {
	const t = performance.now();
	fn();
	return performance.now() - t;
}

const sizes = [
	10_000,
	100_000,
	200_000,
	500_000,
	1_000_000,
];
const datasets = sizes.map((n) => fixturePoints(n, 7));
const features = datasets.map((pts) =>
	pts.map((p) => ({
		type: "Feature",
		properties: null,
		geometry: {
			type: "Point",
			coordinates: [
				p.x,
				p.y,
			],
		},
	})),
);

// warmup
for (let w = 0; w < 5; w++) {
	kn(datasets[1] as TestPoint[]);
	Supercluster && new Supercluster(base).load(features[1] as unknown[]);
}

console.log("   points |           kn | supercluster 9");
sizes.forEach((count, s) => {
	const pts = datasets[s] as TestPoint[];
	const runs = count >= 500_000 ? 5 : 15;
	const a: number[] = [];
	const c: number[] = [];
	for (let r = 0; r < runs; r++) {
		a.push(time(() => kn(pts)));
		if (Supercluster) {
			c.push(time(() => new Supercluster(base).load(features[s] as unknown[])));
		}
	}
	const f = (v: number[]) => (v.length ? `${median(v).toFixed(1)} ms` : "-").padStart(12);
	console.log(`${String(count).padStart(9)} | ${f(a)} | ${f(c)}`);
});
