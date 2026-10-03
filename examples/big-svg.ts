import { KnGmapClusterer } from "../src/index.ts";
import { CATEGORIES, type FleetPoint, fleetIcon, fleetPoints } from "./fleet.ts";
import { fpsMeter, info, setupMap } from "./shared.ts";

const map = await setupMap();
const names = new Map<string, string>(
	CATEGORIES.map((c) => [
		c.id,
		c.name,
	]),
);

const clusterer = new KnGmapClusterer<FleetPoint>(map, {
	cluster: false,
	marker: {
		icon: fleetIcon,
	},
	infoWindow: (e) =>
		`<b>${names.get(e.point.category)} #${e.point.id}</b><br>Speed: ${e.point.speed} km/h`,
});

function label(n: number): string {
	return n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}k`;
}

async function load(count: number): Promise<void> {
	for (const b of document.querySelectorAll("#counts button")) {
		b.classList.toggle("active", b.textContent === label(count));
	}
	info(`Generating ${label(count)} points…`);
	await new Promise((r) => setTimeout(r, 20));
	const points = fleetPoints(count, 4);
	const t = performance.now();
	await clusterer.load(points, {
		fit: false,
	});
	info(`${label(count)} SVG markers ready in ${(performance.now() - t).toFixed(0)} ms`);
}

const box = document.querySelector("#counts") as HTMLElement;
for (const c of [
	50_000,
	100_000,
	200_000,
	500_000,
]) {
	const b = document.createElement("button");
	b.type = "button";
	b.textContent = label(c);
	b.onclick = () => load(c);
	box.append(b);
}

(document.querySelector("#cluster") as HTMLInputElement).onchange = (e) => {
	void clusterer.setOptions({
		cluster: (e.target as HTMLInputElement).checked ? {} : false,
	});
};

fpsMeter(document.querySelector("#fps") as HTMLElement);
await load(200_000);
