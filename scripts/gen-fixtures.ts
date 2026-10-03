/**
 * Generate the supercluster parity fixtures used by tests/cluster-index.test.ts
 *
 * supercluster is NOT a dependency of the project: install it anywhere, once, then run:
 *   node --experimental-strip-types scripts/gen-fixtures.ts /path/to/node_modules/supercluster/index.js
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { FIXTURE_OPTIONS, fixturePoints } from "../tests/helpers.ts";

interface ScFeature {
	geometry: {
		coordinates: [
			number,
			number,
		];
	};
	properties: {
		cluster?: boolean;
		cluster_id?: number;
		point_count?: number;
		i?: number;
	};
}

interface ScIndex {
	load(points: unknown[]): ScIndex;
	getClusters(
		bbox: [
			number,
			number,
			number,
			number,
		],
		zoom: number,
	): ScFeature[];
	getClusterExpansionZoom(id: number): number;
	getLeaves(id: number, limit: number, offset: number): ScFeature[];
}

type ScCtor = new (opts: Record<string, unknown>) => ScIndex;

const path = process.argv[2];
if (!path) {
	throw new Error("Usage: gen-fixtures.ts <path to supercluster/index.js>");
}

const mod = (await import(pathToFileURL(path).href)) as {
	default: ScCtor;
};
const Supercluster = mod.default;

const points = fixturePoints();
const index = new Supercluster({
	minZoom: FIXTURE_OPTIONS.minZoom,
	maxZoom: FIXTURE_OPTIONS.maxZoom,
	minPoints: FIXTURE_OPTIONS.minPoints,
	radius: FIXTURE_OPTIONS.radius,
	extent: FIXTURE_OPTIONS.extent,
	nodeSize: 64,
}).load(
	points.map((p, i) => ({
		type: "Feature",
		properties: {
			i,
		},
		geometry: {
			type: "Point",
			coordinates: [
				p.x,
				p.y,
			],
		},
	})),
);

const zooms: unknown[] = [];
for (let z = FIXTURE_OPTIONS.minZoom; z <= FIXTURE_OPTIONS.maxZoom + 1; z++) {
	const items = index
		.getClusters(
			[
				-180,
				-85,
				180,
				85,
			],
			z,
		)
		.map((f) => {
			const [lng, lat] = f.geometry.coordinates;
			return f.properties.cluster
				? {
						id: f.properties.cluster_id,
						count: f.properties.point_count,
						lng,
						lat,
						expansionZoom: index.getClusterExpansionZoom(
							f.properties.cluster_id as number,
						),
						leaves: index
							.getLeaves(
								f.properties.cluster_id as number,
								Number.POSITIVE_INFINITY,
								0,
							)
							.map((l) => l.properties.i as number)
							.sort((a, b) => a - b),
					}
				: {
						point: f.properties.i,
					};
		});
	zooms.push({
		zoom: z,
		items,
	});
}

writeFileSync(
	new URL("../tests/fixtures/supercluster.json", import.meta.url),
	`${JSON.stringify({
		generatedWith: "supercluster@9.1.0",
		zooms,
	})}\n`,
);
console.log("Fixtures written");
