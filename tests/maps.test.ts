import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import { googleMapsUrl } from "../src/maps/loader.ts";
import { type KnMapInstance, KnMapManager } from "../src/maps/map-manager.ts";
import { staticMapUrl } from "../src/maps/static-map.ts";
import { knTiles } from "../src/maps/tile-layers.ts";
import { VERSION } from "../src/version.ts";

describe("staticMapUrl", () => {
	test("defaults reproduce the alarm thumbnail", () => {
		const url = new URL(
			staticMapUrl("KEY", {
				x: 2.35,
				y: 48.85,
			}),
		);
		assert.equal(url.origin + url.pathname, "https://maps.googleapis.com/maps/api/staticmap");
		assert.equal(url.searchParams.get("size"), "458x250");
		assert.equal(url.searchParams.get("scale"), "1");
		assert.equal(url.searchParams.get("maptype"), "satellite");
		assert.equal(url.searchParams.get("format"), "png");
		assert.equal(url.searchParams.get("key"), "KEY");
		assert.deepEqual(url.searchParams.getAll("markers"), [
			"size:mid|color:0xD43333|48.85,2.35",
		]);
		assert.equal(url.searchParams.get("zoom"), null);
	});

	test("options", () => {
		const url = new URL(
			staticMapUrl(
				"K&Y",
				{
					x: 1,
					y: 2,
				},
				{
					size: [
						100,
						50,
					],
					zoom: 12,
					scale: 2,
					maptype: "roadmap",
					markers: [
						{
							x: 1,
							y: 2,
							color: "blue",
							label: "A",
						},
						{
							x: 3,
							y: 4,
							size: "tiny",
						},
					],
				},
			),
		);
		assert.equal(url.searchParams.get("key"), "K&Y");
		assert.equal(url.searchParams.get("center"), "2,1");
		assert.equal(url.searchParams.get("zoom"), "12");
		assert.deepEqual(url.searchParams.getAll("markers"), [
			"size:mid|color:blue|label:A|2,1",
			"size:tiny|color:0xD43333|4,3",
		]);
	});
});

describe("knTiles", () => {
	test("OpenStreetMap (single domain)", () => {
		assert.equal(knTiles.osm().getTileUrl(3, 5, 4), "https://tile.openstreetmap.org/4/3/5.png");
	});

	test("x wraps around the world, y outside returns null", () => {
		const osm = knTiles.osm();
		assert.equal(osm.getTileUrl(-1, 0, 2), "https://tile.openstreetmap.org/2/3/0.png");
		assert.equal(osm.getTileUrl(5, 0, 2), "https://tile.openstreetmap.org/2/1/0.png");
		assert.equal(osm.getTileUrl(0, 4, 2), null);
		assert.equal(osm.getTileUrl(0, -1, 2), null);
	});

	test("subdomains", () => {
		const fr = knTiles.osmFr();
		assert.equal(fr.getTileUrl(0, 0, 3), "https://a.tile.openstreetmap.fr/osmfr/3/0/0.png");
		assert.equal(fr.getTileUrl(1, 0, 3), "https://b.tile.openstreetmap.fr/osmfr/3/1/0.png");
	});

	test("IGN WMTS", () => {
		const url = new URL(knTiles.ignPhotos().getTileUrl(10, 20, 6) as string);
		assert.equal(url.origin + url.pathname, "https://data.geopf.fr/wmts");
		assert.equal(url.searchParams.get("LAYER"), "ORTHOIMAGERY.ORTHOPHOTOS");
		assert.equal(url.searchParams.get("FORMAT"), "image/jpeg");
		assert.equal(url.searchParams.get("TILEMATRIXSET"), "PM");
		assert.equal(url.searchParams.get("TILEMATRIX"), "6");
		assert.equal(url.searchParams.get("TILEROW"), "20");
		assert.equal(url.searchParams.get("TILECOL"), "10");
		assert.equal(knTiles.ignPlan().id, "ign_plan");
	});

	test("custom xyz with a function", () => {
		const t = knTiles.xyz({
			id: "x",
			name: "X",
			url: (x, y, z) => `${z}-${x}-${y}`,
		});
		assert.equal(t.getTileUrl(1, 2, 3), "3-1-2");
	});
});

describe("loader", () => {
	test("script URL", () => {
		const url = new URL(
			googleMapsUrl({
				apiKey: "KEY",
				language: "fr",
				region: "FR",
				libraries: [
					"places",
					"geometry",
				],
			}),
		);
		assert.equal(url.searchParams.get("key"), "KEY");
		assert.equal(url.searchParams.get("v"), "weekly");
		assert.equal(url.searchParams.get("loading"), "async");
		assert.equal(url.searchParams.get("language"), "fr");
		assert.equal(url.searchParams.get("region"), "FR");
		assert.equal(url.searchParams.get("libraries"), "places,geometry");
		assert.ok(url.searchParams.get("callback"));
	});
});

describe("KnMapManager", () => {
	class TestManager extends KnMapManager {
		created = 0;
		protected override load(): Promise<void> {
			return new Promise((r) => setTimeout(r, 10));
		}
		protected override create(key: string): KnMapInstance {
			this.created++;
			return {
				key,
				el: {} as HTMLDivElement,
				map: {
					setOptions: () => undefined,
				} as unknown as google.maps.Map,
			};
		}
	}

	test("concurrent get() share the same creation", async () => {
		const m = new TestManager();
		const [a, b] = await Promise.all([
			m.get("main"),
			m.get("main"),
		]);
		assert.equal(m.created, 1);
		assert.equal(a, b);
		assert.equal(await m.get("main"), a);
		assert.equal(m.created, 1);
		await m.get("other");
		assert.equal(m.created, 2);
		assert.deepEqual(m.keys(), [
			"main",
			"other",
		]);
	});
});

test("VERSION matches package.json", () => {
	const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
		version: string;
	};
	assert.equal(VERSION, pkg.version);
});
