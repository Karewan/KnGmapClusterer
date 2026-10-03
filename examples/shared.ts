/**
 * Shared helpers of the examples
 */

import { KnMaps, knTiles } from "../src/index.ts";
import { KnOverlay } from "../src/render/overlay.ts";

const apiKey: string = import.meta.env["VITE_GMAPS_KEY"] ?? "";

KnMaps.configure({
	apiKey,
	language: "en",
	region: "FR",
	defaults: {
		center: {
			lat: 46.6,
			lng: 2.4,
		},
		zoom: 6,
		tilt: 0,
		maxZoom: 21,
		gestureHandling: "greedy",
		rotateControl: false,
		fullscreenControl: false,
		restriction: {
			latLngBounds: {
				north: 85,
				south: -85,
				west: -180,
				east: 180,
			},
			strictBounds: true,
		},
	},
	tiles: [
		knTiles.osm(),
		knTiles.osmFr(),
		knTiles.ignPlan(),
		knTiles.ignPhotos(),
	],
	theme: "auto",
});

export { apiKey };

/** Create (or reuse) a map and display it in #map */
export async function setupMap(
	key = "main",
	options?: google.maps.MapOptions,
): Promise<google.maps.Map> {
	const { el, map } = await KnMaps.get(key, {
		// without API key, the Google tiles are refused: use OpenStreetMap
		...(apiKey
			? {}
			: {
					mapTypeId: "osm",
				}),
		...options,
	});
	document.querySelector("#map")?.append(el);
	// debug access from the console
	Object.assign(window, {
		knMap: map,
		knOverlay: KnOverlay.for(map),
	});
	return map;
}

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

export interface DemoPoint {
	x: number;
	y: number;
	id: number;
	type: "alarm" | "warning" | "ok";
	value: number;
	label?: string;
}

const CITIES: [
	number,
	number,
	number,
][] = [
	// lng, lat, weight
	[
		2.35,
		48.86,
		10,
	],
	[
		4.84,
		45.76,
		5,
	],
	[
		5.37,
		43.3,
		5,
	],
	[
		1.44,
		43.6,
		4,
	],
	[
		-0.58,
		44.84,
		4,
	],
	[
		-1.55,
		47.22,
		3,
	],
	[
		3.06,
		50.63,
		3,
	],
	[
		7.75,
		48.58,
		3,
	],
	[
		7.26,
		43.7,
		3,
	],
	[
		-1.68,
		48.11,
		2,
	],
	[
		3.88,
		43.61,
		2,
	],
	[
		5.72,
		45.19,
		2,
	],
];

/** Random points around french cities */
export function randomPoints(count: number, seed = 1): DemoPoint[] {
	const rnd = prng(seed);
	const total = CITIES.reduce((s, c) => s + c[2], 0);
	const points: DemoPoint[] = new Array(count);

	for (let i = 0; i < count; i++) {
		let r = rnd() * total;
		let city = CITIES[0] as [
			number,
			number,
			number,
		];
		for (const c of CITIES) {
			r -= c[2];
			if (r <= 0) {
				city = c;
				break;
			}
		}
		// gaussian spread (Box-Muller): dense center, sparse suburbs
		const spread = rnd() < 0.6 ? 0.04 : 0.3;
		const radius = Math.sqrt(-2 * Math.log(1 - rnd())) * spread;
		const angle = 2 * Math.PI * rnd();
		const dx = radius * Math.cos(angle);
		const dy = radius * Math.sin(angle) * 0.7;
		const t = rnd();
		points[i] = {
			x: city[0] + dx,
			y: city[1] + dy,
			id: i,
			type: t < 0.05 ? "alarm" : t < 0.25 ? "warning" : "ok",
			value: Math.round(rnd() * 100),
		};
	}
	return points;
}

/** Simple FPS meter */
export function fpsMeter(el: HTMLElement): void {
	let frames = 0;
	let last = performance.now();
	const loop = (now: number) => {
		frames++;
		if (now - last >= 500) {
			el.textContent = `${Math.round((frames * 1000) / (now - last))} fps`;
			frames = 0;
			last = now;
		}
		requestAnimationFrame(loop);
	};
	requestAnimationFrame(loop);
}

/** Display a message in #info */
export function info(html: string): void {
	const el = document.querySelector("#info");
	if (el) {
		el.innerHTML = html;
	}
}
