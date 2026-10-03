import { KnGmapClusterer } from "../src/index.ts";
import { CATEGORIES, type FleetPoint, fleetIcon, fleetPoints, iconUrl } from "./fleet.ts";
import { info, setupMap } from "./shared.ts";

const map = await setupMap();

// gallery of the generated icons
const gallery = document.querySelector("#gallery") as HTMLElement;
for (const c of CATEGORIES) {
	const img = document.createElement("img");
	img.src = iconUrl(c.icon);
	img.title = c.name;
	gallery.append(img);
}
// external SVG and PNG files work too
for (const url of [
	"/icons/alarm.svg",
	"/icons/vehicle.png",
]) {
	const img = document.createElement("img");
	img.src = url;
	gallery.append(img);
}

const names = new Map<string, string>(
	CATEGORIES.map((c) => [
		c.id,
		c.name,
	]),
);

const clusterer = new KnGmapClusterer<FleetPoint>(map, {
	marker: {
		icon: fleetIcon,
	},
	// cluster color of the main category
	aggregate: {
		categories: {
			countBy: "category",
		},
	},
	cluster: {
		donut: {
			aggregate: "categories",
			colors: Object.fromEntries(
				CATEGORIES.map((c) => [
					c.id,
					c.color,
				]),
			),
		},
		color: "#fff",
		font: {
			color: "#202124",
		},
	},
	infoWindow: (e) =>
		`<b>${names.get(e.point.category)} #${e.point.id}</b><br>Speed: ${e.point.speed} km/h`,
});

const points = fleetPoints(8000);
await clusterer.load(points);
info(`${points.length} points, ${CATEGORIES.length} generated SVG icons`);
