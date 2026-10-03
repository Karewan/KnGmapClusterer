import { MarkerClusterer } from "@googlemaps/markerclusterer";
import { KnGmapClusterer } from "../src/index.ts";
import { type DemoPoint, info, randomPoints, setupMap } from "./shared.ts";

interface V4 {
	load(points: DemoPoint[], autoCenterZoom?: boolean): void;
	clearMarkers(): void;
}

type V4Ctor = new (map: google.maps.Map, opt?: Record<string, unknown>) => V4;

const map = await setupMap("bench");
const V4Clusterer = (
	window as unknown as {
		KnGmapClustererV4: V4Ctor;
	}
).KnGmapClustererV4;
const results = document.querySelector("#results") as HTMLElement;
const VIEW = {
	center: {
		lat: 46.6,
		lng: 2.4,
	},
	zoom: 6,
};

/** Next frame (with a timeout: no frame at all when the page is hidden) */
const frame = (): Promise<number> =>
	new Promise((r) => {
		requestAnimationFrame(r);
		setTimeout(() => r(performance.now()), 250);
	});
/** Wait for the map "idle" event (it never comes when the view does not change: timeout) */
const idle = (timeout = 1500): Promise<void> =>
	new Promise((r) => {
		const l = google.maps.event.addListenerOnce(map, "idle", () => r());
		setTimeout(() => {
			l.remove();
			r();
		}, timeout);
	});

/** Average frame duration while panning the map */
async function panTest(): Promise<number> {
	const frames: number[] = [];
	let last = await frame();
	for (let i = 0; i < 60; i++) {
		map.panBy(i % 20 < 10 ? 12 : -12, 0);
		const now = await frame();
		frames.push(now - last);
		last = now;
	}
	frames.sort((a, b) => a - b);
	return frames.reduce((s, f) => s + f, 0) / frames.length;
}

function row(lib: string, count: number, load: number, pan: number): void {
	const tr = document.createElement("tr");
	for (const v of [
		lib,
		count.toLocaleString(),
		`${load.toFixed(0)} ms`,
		pan.toFixed(1),
	]) {
		const td = document.createElement("td");
		td.textContent = v;
		tr.append(td);
	}
	results.append(tr);
}

async function reset(): Promise<void> {
	map.setOptions(VIEW);
	await idle().catch(() => undefined);
	await frame();
}

async function benchV5(points: DemoPoint[]): Promise<void> {
	await reset();
	const t = performance.now();
	const c = new KnGmapClusterer<DemoPoint>(map, {
		fit: true,
	});
	await c.load(points);
	await frame();
	const load = performance.now() - t;
	const pan = await panTest();
	row("v5 (WebGL)", points.length, load, pan);
	c.destroy();
}

async function benchV4(points: DemoPoint[]): Promise<void> {
	await reset();
	const t = performance.now();
	const c = new V4Clusterer(map);
	// autoCenterZoom = false is buggy in v4 (draws before indexing): use its default path
	c.load(points, true);
	// v4 only draws on "idle": force one even if its view did not change
	map.panBy(0, 1);
	await idle();
	await frame();
	const load = performance.now() - t;
	const pan = await panTest();
	row("v4 (Marker)", points.length, load, pan);
	c.clearMarkers();
}

async function benchGoogle(points: DemoPoint[]): Promise<void> {
	await reset();
	const t = performance.now();
	// one marker object per point, as required by @googlemaps/markerclusterer
	const markers = points.map(
		(p) =>
			new google.maps.Marker({
				position: {
					lat: p.y,
					lng: p.x,
				},
			}),
	);
	const c = new MarkerClusterer({
		map,
		markers,
	});
	await idle();
	await frame();
	const load = performance.now() - t;
	const pan = await panTest();
	row("@googlemaps/markerclusterer", points.length, load, pan);
	c.clearMarkers();
	c.setMap(null);
}

async function run(count: number): Promise<void> {
	info(`Generating ${count.toLocaleString()} points…`);
	const points = randomPoints(count);
	info("v5…");
	await benchV5(points);
	info("v4…");
	await benchV4(points);
	if ((document.querySelector("#google") as HTMLInputElement).checked) {
		info("@googlemaps/markerclusterer…");
		await benchGoogle(points);
	}
	info("Done");
}

const box = document.querySelector("#counts") as HTMLElement;
for (const count of [
	10_000,
	50_000,
	100_000,
	200_000,
	500_000,
]) {
	const b = document.createElement("button");
	b.type = "button";
	b.textContent = count >= 1000 ? `${count / 1000}k` : String(count);
	b.onclick = async () => {
		for (const o of box.querySelectorAll("button")) {
			(o as HTMLButtonElement).disabled = true;
		}
		try {
			await run(count);
		} finally {
			for (const o of box.querySelectorAll("button")) {
				(o as HTMLButtonElement).disabled = false;
			}
		}
	};
	box.append(b);
}
info("Choose a number of points. Keep the window visible during the test.");
