import { KnGmapClusterer, KnMaps, type KnThemeMode, staticMapUrl } from "../src/index.ts";
import { apiKey, info, randomPoints } from "./shared.ts";

const left = document.querySelector("#left") as HTMLElement;
const right = document.querySelector("#right") as HTMLElement;
let side: HTMLElement = left;

KnMaps.configure({
	onMapTypeChange: (_map, type, key) => info(`Map "${key}": type ${type}`),
});

/** Show the shared map instance in a view, with a fresh layer */
async function show(container: HTMLElement): Promise<void> {
	// release: detaches the element and destroys the layers, the instance is kept
	KnMaps.release("shared");
	const t = performance.now();
	const { el, map } = await KnMaps.get(
		"shared",
		apiKey
			? {}
			: {
					mapTypeId: "osm",
				},
	);
	container.append(el);
	left.classList.toggle("active", container === left);
	right.classList.toggle("active", container === right);

	const clusterer = new KnGmapClusterer(map);
	await clusterer.load(randomPoints(3000, container === left ? 1 : 2));
	info(
		`Instance reused in ${(performance.now() - t).toFixed(0)} ms (${KnMaps.keys().length} instance)`,
	);
}

await show(left);

(document.querySelector("#move") as HTMLButtonElement).onclick = () => {
	side = side === left ? right : left;
	void show(side);
};

(document.querySelector("#theme") as HTMLSelectElement).onchange = (e) => {
	KnMaps.setTheme((e.target as HTMLSelectElement).value as KnThemeMode);
};

(document.querySelector("#type") as HTMLSelectElement).onchange = (e) => {
	KnMaps.peek("shared")?.map.setMapTypeId((e.target as HTMLSelectElement).value);
};

// static image (alarm thumbnail): needs an API key
const thumb = document.querySelector("#thumb") as HTMLImageElement;
if (apiKey) {
	thumb.src = staticMapUrl(apiKey, {
		x: 2.2945,
		y: 48.8584,
	});
} else {
	thumb.remove();
}
