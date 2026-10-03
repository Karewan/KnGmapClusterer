import { KnZoneLayer } from "../src/index.ts";
import { info, prng, setupMap } from "./shared.ts";

interface Site {
	x: number;
	y: number;
	id: number;
	group?: string;
	groupLabel?: string;
}

const rnd = prng(11);

/** Points of a group: blobs, a road-like stretch, an L shape... */
function group(
	key: string,
	label: string,
	shape: "blob" | "road" | "twin" | "l",
	cx: number,
	cy: number,
	size: number,
	count: number,
	out: Site[],
): void {
	for (let i = 0; i < count; i++) {
		let x = cx;
		let y = cy;
		const g = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
		if (shape === "blob") {
			x += g() * size;
			y += g() * size * 0.7;
		} else if (shape === "road") {
			const t = rnd() - 0.5;
			x += t * size * 3 + g() * size * 0.12;
			y += Math.sin(t * 5) * size * 0.4 + g() * size * 0.12;
		} else if (shape === "twin") {
			const side = rnd() < 0.5 ? -1 : 1;
			x += side * size * 1.2 + g() * size * 0.5;
			y += g() * size * 0.4;
		} else {
			if (rnd() < 0.5) {
				x += (rnd() - 0.2) * size * 2;
				y += g() * size * 0.15;
			} else {
				x += g() * size * 0.15;
				y += (rnd() - 0.2) * size * 1.5;
			}
		}
		out.push({
			x,
			y,
			id: out.length,
			group: key,
			groupLabel: label,
		});
	}
}

const points: Site[] = [];
group("paris", "Paris", "blob", 2.35, 48.86, 0.12, 400, points);
group("lyon", "Lyon", "road", 4.84, 45.76, 0.1, 250, points);
group("marseille", "Marseille", "blob", 5.38, 43.3, 0.08, 200, points);
group("bordeaux", "Bordeaux", "l", -0.58, 44.84, 0.12, 180, points);
group("lille", "Lille / Roubaix", "twin", 3.1, 50.66, 0.06, 160, points);
group("toulouse", "Toulouse", "blob", 1.44, 43.6, 0.07, 140, points);
group("nantes", "Nantes", "road", -1.55, 47.22, 0.06, 120, points);
group("strasbourg", "Strasbourg", "blob", 7.75, 48.58, 0.05, 90, points);
group("nice", "Côte d'Azur", "road", 7.1, 43.65, 0.12, 150, points);
group("rennes", "Rennes", "twin", -1.68, 48.11, 0.05, 80, points);
// points without group (always displayed)
for (let i = 0; i < 12; i++) {
	points.push({
		x: -1 + rnd() * 8,
		y: 44 + rnd() * 5,
		id: points.length,
	});
}

const map = await setupMap();
const zones = new KnZoneLayer<Site>(map, {
	infoWindow: (e) => `<b>Site #${e.point.id}</b><br>${e.point.groupLabel ?? "no zone"}`,
	onZoneOpen: (z) => info(z ? `Zone "${z.label}": ${z.count} sites` : "No opened zone"),
});

const t = performance.now();
await zones.load(points);
info(`${zones.getZones().length} zones computed in ${(performance.now() - t).toFixed(0)} ms`);

(document.querySelector("#concavity") as HTMLSelectElement).onchange = (e) => {
	void zones.setOptions({
		concavity: Number((e.target as HTMLSelectElement).value),
	});
};

Object.assign(window, {
	knZones: zones,
});

(document.querySelector("#cluster") as HTMLInputElement).onchange = (e) => {
	void zones.setOptions({
		cluster: (e.target as HTMLInputElement).checked,
	});
};
