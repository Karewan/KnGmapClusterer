import { type KnClusterOptions, KnGmapClusterer, type KnIcon } from "../src/index.ts";
import { type DemoPoint, info, randomPoints, setupMap } from "./shared.ts";

const map = await setupMap();

// aggregates computed on every cluster (in the worker for big datasets)
const aggregate = {
	alarms: {
		countBy: "type",
	},
	total: {
		sum: "value",
	},
	max: {
		max: "value",
	},
} as const;

type Agg = typeof aggregate;

const COLORS: Record<DemoPoint["type"], string> = {
	alarm: "#d93025",
	warning: "#f29900",
	ok: "#1e8e3e",
};

// markers: SVG for the alarms, PNG for the warnings, built-in pin for the others
const markerIcon = (p: DemoPoint): KnIcon =>
	p.type === "alarm"
		? {
				url: "/icons/alarm.svg",
				size: [
					28,
					40,
				],
			}
		: p.type === "warning"
			? {
					url: "/icons/vehicle.png",
					size: [
						32,
						32,
					],
					anchor: [
						16,
						16,
					],
				}
			: {
					pin: COLORS.ok,
				};

const modes: Record<string, KnClusterOptions<Agg>> = {
	"Color from a closure": {
		// red if the cluster contains an alarm, orange if a warning, else green
		style: (c) => {
			const types = c.agg.alarms;
			return {
				color: types["alarm"]
					? COLORS.alarm
					: types["warning"]
						? COLORS.warning
						: COLORS.ok,
				size: 28 + Math.min(32, Math.log2(c.count) * 4),
			};
		},
	},
	Donut: {
		color: "#fff",
		font: {
			color: "#202124",
		},
		donut: {
			aggregate: "alarms",
			colors: COLORS,
		},
	},
	"SVG icon": {
		style: (c) => ({
			icon: {
				url: "/icons/cluster.svg",
				size: [
					48,
					48,
				],
				anchor: [
					24,
					24,
				],
			},
			text: c.countAbbr,
		}),
	},
	"Custom text": {
		style: (c) => ({
			color: "#3949ab",
			size: 44,
			text: `${Math.round(c.agg.total / c.count)}`,
			font: {
				size: 11,
			},
		}),
	},
};

const clusterer = new KnGmapClusterer<DemoPoint, Agg>(map, {
	aggregate,
	marker: {
		icon: markerIcon,
		label: (p) => (p.type === "alarm" ? "!" : null),
	},
	cluster: modes["Color from a closure"] as KnClusterOptions<Agg>,
	onClusterClick: (e) => {
		const c = e.cluster;
		info(
			`Cluster of ${c.count} points: ${c.agg.alarms["alarm"] ?? 0} alarms, ` +
				`${c.agg.alarms["warning"] ?? 0} warnings, max value ${c.agg.max}`,
		);
		map.setOptions({
			center: {
				lat: c.y,
				lng: c.x,
			},
			zoom: clusterer.getClusterExpansionZoom(c.id),
		});
	},
	infoWindow: (e) => `<b>#${e.point.id}</b> ${e.point.type}<br>value ${e.point.value}`,
});

const box = document.querySelector("#modes") as HTMLElement;
for (const [name, cluster] of Object.entries(modes)) {
	const b = document.createElement("button");
	b.type = "button";
	b.textContent = name;
	b.classList.toggle("active", name === "Color from a closure");
	b.onclick = () => {
		for (const o of box.querySelectorAll("button")) {
			o.classList.toggle("active", o === b);
		}
		void clusterer.setOptions({
			cluster,
		});
	};
	box.append(b);
}

await clusterer.load(randomPoints(20_000, 3));
info("Click a cluster to see its aggregates.");
