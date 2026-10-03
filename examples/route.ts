import { type KnIcon, KnRouteLayer } from "../src/index.ts";
import { info, prng, setupMap } from "./shared.ts";

interface TrackPoint {
	x: number;
	y: number;
	/** km/h (GPS) */
	speed: number;
	/** ISO date */
	time: string;
	event?: "stop" | "alarm";
}

const START = Date.parse("2026-10-03T08:00:00Z");

/** Simulated GPS track from Paris to Lyon (one point per second) */
function track(count: number): TrackPoint[] {
	const rnd = prng(7);
	const points: TrackPoint[] = [];
	let x = 2.35;
	let y = 48.85;
	let heading = Math.atan2(45.76 - y, 4.84 - x);
	let speed = 50;
	for (let i = 0; i < count; i++) {
		// drift toward Lyon with some wandering
		const target = Math.atan2(45.76 - y, 4.84 - x);
		heading += (target - heading) * 0.02 + (rnd() - 0.5) * 0.25;
		speed = Math.max(0, Math.min(130, speed + (rnd() - 0.5) * 8));
		const step = (speed / 3600) * 1.0 * 0.009; // ~1 s per point
		x += Math.cos(heading) * step;
		y += Math.sin(heading) * step * 0.7;
		const p: TrackPoint = {
			x,
			y,
			speed,
			time: new Date(START + i * 1000).toISOString(),
		};
		if (i > 0 && i % 5000 === 0) {
			p.event = rnd() < 0.5 ? "stop" : "alarm";
		}
		points.push(p);
	}
	return points;
}

function speedColor(speed: number): string {
	// green (slow) -> yellow -> red (fast)
	const t = Math.min(1, speed / 130);
	const hue = Math.round(120 - 120 * t);
	return `hsl(${hue}, 85%, 45%)`;
}

const map = await setupMap();
const points = track(40_000);

const route = new KnRouteLayer<TrackPoint>(map, {
	color: (a) => speedColor(a.speed),
	width: 6,
	arrows: {
		spacing: 70,
	},
	points: {
		minZoom: 15,
	},
	pinned: (p, i, all) => i === 0 || i === all.length - 1 || p.event !== undefined,
	pinnedIcon: (p, i, all): KnIcon =>
		i === 0
			? {
					pin: "#1e8e3e",
				}
			: i === all.length - 1
				? {
						pin: "#d93025",
					}
				: {
						pin: p.event === "alarm" ? "#d93025" : "#f29900",
						size: 32,
					},
	time: (p) => p.time,
	speed: (p) => p.speed,
	infoWindow: (e) =>
		`<b>Point ${e.index}</b><br>${new Date(e.point.time).toLocaleTimeString()}<br>${Math.round(e.point.speed)} km/h${e.point.event ? `<br>Event: ${e.point.event}` : ""}`,
});

const t = performance.now();
await route.load(points);
const loadTime = performance.now() - t;
const stats = route.getStats();
const hms = (ms: number | null): string =>
	ms === null ? "-" : new Date(ms).toISOString().slice(11, 19);
const kmh = (v: number | null): string => (v === null ? "-" : `${v.toFixed(1)} km/h`);
info(
	[
		`${points.length} points loaded in ${loadTime.toFixed(0)} ms`,
		`Distance: ${(stats.distance / 1000).toFixed(1)} km`,
		`Duration: ${hms(stats.duration)} (moving ${hms(stats.movingDuration)})`,
		`Average speed: ${kmh(stats.averageSpeed)} (moving ${kmh(stats.averageMovingSpeed)})`,
		`Max speed: ${kmh(stats.maxSpeed)}`,
	].join("<br>"),
);

const buttons = {
	speed: document.querySelector("#speed") as HTMLButtonElement,
	plain: document.querySelector("#plain") as HTMLButtonElement,
	arrows: document.querySelector("#arrows") as HTMLButtonElement,
};
buttons.speed.onclick = () => {
	route.setOptions({
		color: (a) => speedColor(a.speed),
	});
	buttons.speed.classList.add("active");
	buttons.plain.classList.remove("active");
};
buttons.plain.onclick = () => {
	route.setOptions({
		color: "#1a73e8",
	});
	buttons.plain.classList.add("active");
	buttons.speed.classList.remove("active");
};
buttons.arrows.onclick = () => {
	const on = !buttons.arrows.classList.contains("active");
	route.setOptions({
		arrows: on
			? {
					spacing: 70,
				}
			: false,
	});
	buttons.arrows.classList.toggle("active", on);
};

Object.assign(window, {
	knRoute: route,
});
