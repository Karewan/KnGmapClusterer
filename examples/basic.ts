import { KnGmapClusterer } from "../src/index.ts";
import { type DemoPoint, fpsMeter, info, randomPoints, setupMap } from "./shared.ts";

const map = await setupMap();
const clusterer = new KnGmapClusterer<DemoPoint>(map, {
	// small window above the marker, like the standard Google markers
	infoWindow: (e) =>
		`<b>Point #${e.point.id}</b><br>Type: ${e.point.type}<br>Value: ${e.point.value}`,
});

const points = randomPoints(5000);
const t = performance.now();
await clusterer.load(points);
info(`${points.length} points indexed in ${(performance.now() - t).toFixed(0)} ms`);

fpsMeter(document.querySelector("#fps") as HTMLElement);
