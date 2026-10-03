import { KnGmapClusterer, type KnIcon, knSvg } from "../src/index.ts";
import { info, setupMap } from "./shared.ts";

interface Place {
	x: number;
	y: number;
	name: string;
	kind: "monument" | "station" | "custom" | "vehicle";
	label?: string;
}

const ICONS: Record<Place["kind"], KnIcon> = {
	monument: knSvg.pin({
		color: "#d93025",
		glyph: "star",
	}),
	station: knSvg.badge({
		color: "#1a73e8",
		glyph: "flag",
	}),
	// built-in pin (no SVG), its label is drawn on it
	custom: {
		pin: "#9334e6",
	},
	vehicle: knSvg.badge({
		color: "#1e8e3e",
		glyph: "car",
		size: 34,
	}),
};

const map = await setupMap();

// a few markers, no clustering: every marker is always drawn
const markers = new KnGmapClusterer<Place>(map, {
	cluster: false,
	marker: {
		icon: (p) => ICONS[p.kind],
		label: (p) => p.label,
	},
	infoWindow: (e) => {
		const el = document.createElement("div");
		el.innerHTML = `<b>${e.point.name}</b><br>${e.point.y.toFixed(5)}, ${e.point.x.toFixed(5)}<br>`;
		const remove = document.createElement("button");
		remove.type = "button";
		remove.textContent = "Remove";
		remove.onclick = () => {
			void markers.remove(e.point).then(count);
		};
		el.append(remove);
		return el;
	},
});

// one marker
await markers.load([
	{
		x: 2.2945,
		y: 48.8584,
		name: "Eiffel Tower",
		kind: "monument",
	},
]);

// several markers
await markers.add(
	{
		x: 2.3499,
		y: 48.853,
		name: "Notre-Dame",
		kind: "monument",
	},
	{
		x: 2.295,
		y: 48.8738,
		name: "Arc de Triomphe",
		kind: "monument",
	},
	{
		x: 2.3554,
		y: 48.8809,
		name: "Gare du Nord",
		kind: "station",
	},
	{
		x: 2.3735,
		y: 48.8443,
		name: "Gare de Lyon",
		kind: "station",
	},
);
markers.fitBounds();

function count(): void {
	info(`${markers.getPoints().length} markers`);
}
count();

// ---------------------------------------------------------------------------------------------
// Add on right click (or long press), numbered
// ---------------------------------------------------------------------------------------------

let next = 1;
map.addListener("contextmenu", (e: google.maps.MapMouseEvent) => {
	if (!e.latLng) {
		return;
	}
	void markers
		.add({
			x: e.latLng.lng(),
			y: e.latLng.lat(),
			name: `Marker ${next}`,
			kind: "custom",
			label: String(next++),
		})
		.then(count);
});

(document.querySelector("#clear") as HTMLButtonElement).onclick = () => {
	void markers.remove((p) => p.kind === "custom").then(count);
};

// ---------------------------------------------------------------------------------------------
// Moving marker: change the point in place, then refresh()
// ---------------------------------------------------------------------------------------------

const vehicle: Place = {
	x: 2.3376,
	y: 48.8606,
	name: "Vehicle",
	kind: "vehicle",
};
let timer = 0;

(document.querySelector("#move") as HTMLButtonElement).onclick = async (e) => {
	const button = e.target as HTMLButtonElement;
	if (timer) {
		clearInterval(timer);
		timer = 0;
		button.classList.remove("active");
		await markers.remove(vehicle);
		count();
		return;
	}
	button.classList.add("active");
	await markers.add(vehicle);
	count();
	let angle = 0;
	timer = window.setInterval(() => {
		// loop around the center of Paris
		angle += 0.02;
		vehicle.x = 2.3376 + Math.cos(angle) * 0.03;
		vehicle.y = 48.8606 + Math.sin(angle) * 0.02;
		void markers.refresh();
	}, 50);
};
