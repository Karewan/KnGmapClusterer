import {
	KN_HEAT_GRADIENT,
	KnGmapClusterer,
	KnHeatmapLayer,
	type KnHeatmapOptions,
	knSvg,
} from "../src/index.ts";
import { dbColor, dbLabel, noiseSensors, type Sensor } from "./noise.ts";
import { info, setupMap } from "./shared.ts";

const map = await setupMap();
const sensors = noiseSensors();

/** Colors of the levels from 40 dB (transparent) to 120 dB, the same as the markers */
const DB_GRADIENT: readonly string[] = [
	"rgba(30, 142, 62, 0)",
	"rgba(30, 142, 62, 0.6)",
	"rgba(251, 188, 4, 0.75)",
	"rgba(242, 153, 0, 0.85)",
	"rgba(217, 48, 37, 0.92)",
	"rgba(123, 31, 162, 1)",
];

const MODES: Record<string, Partial<KnHeatmapOptions<Sensor>>> = {
	// noise map: each place shows the loudest nearby sensor, the colors are absolute levels
	max: {
		aggregate: "max",
		weight: (s) => s.db - 40,
		max: 80,
	},
	// density of the loud sensors: the more loud sensors, the hotter
	sum: {
		aggregate: "sum",
		weight: (s) => Math.max(0, (s.db - 70) / 10) ** 2,
		max: "auto",
	},
};

const heat = new KnHeatmapLayer<Sensor>(map, {
	...MODES["max"],
	// constant on the ground (the area covered by a sensor), at least 12 px when zoomed out
	radius: 1200,
	radiusUnit: "m",
	minRadius: 12,
	gradient: DB_GRADIENT,
	opacity: 0.7,
});
const t = performance.now();
heat.load(sensors);
info(`${sensors.length} noise sensors loaded in ${(performance.now() - t).toFixed(0)} ms`);

// ---------------------------------------------------------------------------------------------
// Markers (info window with the level)
// ---------------------------------------------------------------------------------------------

const icon = (s: Sensor) =>
	s.source
		? knSvg.badge({
				color: dbColor(s.db),
				glyph: "alert",
				size: 30,
			})
		: {
				circle: dbColor(s.db),
				radius: 4,
				strokeWidth: 1,
			};

const infoWindow = (e: { point: Sensor }) =>
	`<b>${e.point.source ?? `Sensor #${e.point.id}`}</b><br>` +
	`<span style="font-size: 20px; font-weight: bold; color: ${dbColor(e.point.db)}">${e.point.db} dB</span><br>` +
	dbLabel(e.point.db);

let markers: KnGmapClusterer<Sensor> | null = null;
let clusters: {
	destroy(): void;
} | null = null;

async function showMarkers(on: boolean): Promise<void> {
	markers?.destroy();
	markers = null;
	if (on) {
		// every sensor, no clustering
		markers = new KnGmapClusterer<Sensor>(map, {
			cluster: false,
			fit: false,
			marker: {
				icon,
			},
			// the sources are always visible, above the sensors
			pinned: (s) => s.source !== undefined,
			infoWindow,
		});
		await markers.load(sensors);
	}
}

async function showClusters(on: boolean): Promise<void> {
	clusters?.destroy();
	clusters = null;
	if (on) {
		const aggregate = {
			loudest: {
				max: "db",
			},
		} as const;
		const layer = new KnGmapClusterer<Sensor, typeof aggregate>(map, {
			fit: false,
			aggregate,
			// cluster color: its loudest sensor
			cluster: {
				style: (c) => ({
					color: dbColor(c.agg.loudest),
					text: `${Math.round(c.agg.loudest)} dB`,
					size: 46,
					font: {
						size: 11,
					},
				}),
			},
			marker: {
				icon,
			},
			infoWindow,
		});
		clusters = layer;
		await layer.load(sensors);
	}
}

// ---------------------------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------------------------

const GRADIENTS: Record<string, readonly string[]> = {
	db: DB_GRADIENT,
	default: KN_HEAT_GRADIENT,
	fire: [
		"rgba(255, 255, 178, 0)",
		"rgba(254, 204, 92, 0.7)",
		"rgba(253, 141, 60, 0.85)",
		"rgba(240, 59, 32, 0.95)",
		"rgba(189, 0, 38, 1)",
	],
};

const $ = <E extends HTMLElement>(id: string): E => document.querySelector(`#${id}`) as E;

function slider(id: string, apply: (v: number) => void): void {
	const input = $<HTMLInputElement>(id);
	input.oninput = () => {
		$<HTMLElement>(`${id}V`).textContent = input.value;
		apply(Number(input.value));
	};
}

slider("radius", (v) =>
	heat.setOptions({
		radius: v,
	}),
);
slider("minRadius", (v) =>
	heat.setOptions({
		minRadius: v,
	}),
);
slider("intensity", (v) =>
	heat.setOptions({
		intensity: v,
	}),
);
slider("opacity", (v) =>
	heat.setOptions({
		opacity: v,
	}),
);

$<HTMLSelectElement>("mode").onchange = (e) => {
	heat.setOptions(MODES[(e.target as HTMLSelectElement).value] ?? {});
};

$<HTMLSelectElement>("gradient").onchange = (e) => {
	heat.setOptions({
		gradient: GRADIENTS[(e.target as HTMLSelectElement).value] ?? DB_GRADIENT,
	});
};

$<HTMLInputElement>("heat").onchange = (e) => {
	heat.setOptions({
		opacity: (e.target as HTMLInputElement).checked
			? Number($<HTMLInputElement>("opacity").value)
			: 0,
	});
};

$<HTMLInputElement>("markers").onchange = (e) => {
	void showMarkers((e.target as HTMLInputElement).checked);
};

$<HTMLInputElement>("clusters").onchange = (e) => {
	void showClusters((e.target as HTMLInputElement).checked);
};

Object.assign(window, {
	knHeat: heat,
});
