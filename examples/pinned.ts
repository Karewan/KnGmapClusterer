import { KnGmapClusterer } from "../src/index.ts";
import { type DemoPoint, info, randomPoints, setupMap } from "./shared.ts";

interface Site extends DemoPoint {
	/** depot of the vehicle: several vehicles at the exact same position */
	depot?: string;
}

const map = await setupMap();

const points: Site[] = randomPoints(6000, 5);

// stacks of points at the exact same position (vehicles parked in the same depot)
const DEPOTS: [
	string,
	number,
	number,
	number,
][] = [
	[
		"Paris - Eiffel Tower",
		2.2945,
		48.8584,
		12,
	],
	[
		"Paris - Gare de Lyon",
		2.3735,
		48.8443,
		25,
	],
	[
		"Paris - Montmartre",
		2.3431,
		48.8867,
		4,
	],
	[
		"La Défense",
		2.2385,
		48.8919,
		18,
	],
	[
		"Versailles",
		2.1204,
		48.8049,
		7,
	],
	[
		"Lyon - Part-Dieu",
		4.8597,
		45.7605,
		30,
	],
	[
		"Lyon - Bellecour",
		4.832,
		45.7578,
		5,
	],
	[
		"Marseille - Old Port",
		5.3698,
		43.2965,
		40,
	],
	[
		"Marseille - Saint-Charles",
		5.3805,
		43.3026,
		9,
	],
	[
		"Toulouse - Capitole",
		1.4442,
		43.6045,
		15,
	],
	[
		"Bordeaux - Station",
		-0.5566,
		44.8261,
		22,
	],
	[
		"Nantes - Castle",
		-1.5497,
		47.2161,
		6,
	],
	[
		"Lille - Grand Place",
		3.0635,
		50.6372,
		11,
	],
	[
		"Strasbourg - Cathedral",
		7.7509,
		48.5818,
		3,
	],
	[
		"Nice - Promenade",
		7.262,
		43.695,
		14,
	],
	[
		"Rennes - République",
		-1.68,
		48.1105,
		8,
	],
	[
		"Montpellier - Comédie",
		3.8796,
		43.6086,
		19,
	],
	[
		"Grenoble - Station",
		5.7146,
		45.1913,
		2,
	],
	[
		"Dijon - Darcy",
		5.0316,
		47.3226,
		10,
	],
	[
		"Reims - Cathedral",
		4.034,
		49.2539,
		60,
	],
];

for (const [name, x, y, count] of DEPOTS) {
	for (let i = 0; i < count; i++) {
		points.push({
			x,
			y,
			id: points.length,
			type: i === 0 ? "warning" : "ok",
			value: 60,
			label: String(count),
			depot: name,
		});
	}
}

const clusterer = new KnGmapClusterer<Site>(map, {
	// alarms are never clustered and always visible
	pinned: (p) => p.type === "alarm",
	marker: {
		// the depots stand out: purple, with the number of vehicles as label
		color: (p) =>
			p.depot
				? "#9334e6"
				: p.type === "alarm"
					? "#d93025"
					: p.type === "warning"
						? "#f29900"
						: "#1e8e3e",
		label: (p) => (p.depot ? p.label : null),
	},
	onMarkerClick: (e) =>
		info(
			`Point #${e.point.id} (${e.point.type})` +
				(e.duplicates.length
					? ` + ${e.duplicates.length} others at the same position`
					: ""),
		),
	duplicates: "info",
	infoWindow: (e) =>
		`<b>Vehicle #${e.point.id}</b><br>${e.point.depot ? `Depot: ${e.point.depot}<br>` : ""}State: ${e.point.type}`,
});

await clusterer.load(points);
info(
	`${points.length} points, ${DEPOTS.length} depots (stacked points), ` +
		`${points.filter((p) => p.type === "alarm").length} pinned alarms`,
);

// buttons to go to the depots
const list = document.querySelector("#depots") as HTMLElement;
for (const [name, x, y, count] of DEPOTS) {
	const b = document.createElement("button");
	b.type = "button";
	b.textContent = `${name} (${count})`;
	b.onclick = () =>
		map.setOptions({
			center: {
				lat: y,
				lng: x,
			},
			zoom: 18,
		});
	list.append(b);
}

(document.querySelector("#duplicates") as HTMLSelectElement).onchange = (e) => {
	const value = (e.target as HTMLSelectElement).value as "spiderfy" | "info" | "merge" | "none";
	void clusterer.setOptions({
		duplicates: value,
	});
};

(document.querySelector("#filter") as HTMLInputElement).onchange = (e) => {
	const on = (e.target as HTMLInputElement).checked;
	void clusterer.setFilter(on ? (p) => p.value >= 50 : null);
};
