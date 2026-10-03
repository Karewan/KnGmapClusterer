import { KnGmapClusterer } from "../src/index.ts";
import { KnOverlay } from "../src/render/overlay.ts";
import { type DemoPoint, info, randomPoints, setupMap } from "./shared.ts";

const map = await setupMap();
const counts = [
	10_000,
	100_000,
	200_000,
	500_000,
	1_000_000,
];
const COLORS = {
	alarm: "#d93025",
	warning: "#f9ab00",
	ok: "#1e8e3e",
};

const clusterer = new KnGmapClusterer<DemoPoint>(map, {
	marker: {
		icon: (p) => ({
			circle: COLORS[p.type],
			radius: 4,
			strokeWidth: 1,
		}),
	},
	onMarkerClick: (e) => info(`Point #${e.point.id} (${e.point.type})`),
});

let current = 0;

async function load(count: number): Promise<void> {
	current = count;
	for (const b of document.querySelectorAll("#counts button")) {
		b.classList.toggle("active", b.textContent === label(count));
	}
	info(`Generating ${label(count)} points…`);
	await new Promise((r) => setTimeout(r, 20));
	const points = randomPoints(count);
	const t = performance.now();
	await clusterer.load(points, {
		fit: false,
	});
	info(`${label(count)} points indexed in ${(performance.now() - t).toFixed(0)} ms`);
}

function label(n: number): string {
	return n >= 1e6 ? `${n / 1e6}M` : `${n / 1e3}k`;
}

const box = document.querySelector("#counts") as HTMLElement;
for (const c of counts) {
	const b = document.createElement("button");
	b.textContent = label(c);
	b.onclick = () => load(c);
	box.append(b);
}

(document.querySelector("#nocluster") as HTMLInputElement).onchange = async (e) => {
	const off = (e.target as HTMLInputElement).checked;
	const t = performance.now();
	await clusterer.setOptions({
		cluster: off ? false : {},
	});
	info(`${label(current)} points reindexed in ${(performance.now() - t).toFixed(0)} ms`);
};

// frame time of the WebGL overlay
const overlay = KnOverlay.for(map);
Object.assign(window, {
	knOverlay: overlay,
	knClusterer: clusterer,
});
const fps = document.querySelector("#fps") as HTMLElement;
setInterval(() => {
	fps.textContent = `last frame rendered in ${overlay.frameTime.toFixed(2)} ms`;
}, 250);

await load(200_000);
