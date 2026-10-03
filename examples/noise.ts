/**
 * Demo data: a noise map (decibels measured by sensors)
 */

import { prng } from "./shared.ts";

export interface Sensor {
	x: number;
	y: number;
	id: number;
	/** measured level in dB(A) */
	db: number;
	/** noise source (for the sensor on the source itself) */
	source?: string;
}

interface Source {
	readonly name: string;
	readonly x: number;
	readonly y: number;
	/** level at the source */
	readonly db: number;
	/** radius (degrees) of the surrounding sensors */
	readonly spread: number;
	/** number of surrounding sensors */
	readonly sensors: number;
}

/** Loud places: the level decreases around them */
const SOURCES: readonly Source[] = [
	{
		name: "Paris-Charles de Gaulle Airport",
		x: 2.55,
		y: 49.009,
		db: 118,
		spread: 0.06,
		sensors: 500,
	},
	{
		name: "Paris-Orly Airport",
		x: 2.3652,
		y: 48.7262,
		db: 112,
		spread: 0.04,
		sensors: 350,
	},
	{
		name: "Stade de France (match)",
		x: 2.3601,
		y: 48.9245,
		db: 105,
		spread: 0.015,
		sensors: 220,
	},
	{
		name: "La Défense (construction site)",
		x: 2.2385,
		y: 48.8919,
		db: 98,
		spread: 0.012,
		sensors: 150,
	},
	{
		name: "Lyon-Saint-Exupéry Airport",
		x: 5.0811,
		y: 45.7256,
		db: 114,
		spread: 0.05,
		sensors: 350,
	},
	{
		name: "Circuit Paul Ricard (race)",
		x: 5.7915,
		y: 43.2506,
		db: 121,
		spread: 0.035,
		sensors: 300,
	},
	{
		name: "Marseille port",
		x: 5.3496,
		y: 43.3302,
		db: 96,
		spread: 0.02,
		sensors: 180,
	},
	{
		name: "Nice Airport",
		x: 7.2159,
		y: 43.6584,
		db: 110,
		spread: 0.03,
		sensors: 250,
	},
	{
		name: "Toulouse-Blagnac Airport (Airbus)",
		x: 1.3678,
		y: 43.6293,
		db: 115,
		spread: 0.04,
		sensors: 300,
	},
	{
		name: "Bordeaux Rock Festival",
		x: -0.5562,
		y: 44.8455,
		db: 108,
		spread: 0.01,
		sensors: 160,
	},
];

/** Isolated loud sensors: they stand out of the background */
const PEAKS: readonly [
	string,
	number,
	number,
	number,
][] = [
	[
		"Open-air concert",
		1.0,
		47.4,
		109,
	],
	[
		"Quarry blasting",
		3.6,
		45.3,
		117,
	],
	[
		"Shooting range",
		-1.2,
		46.6,
		112,
	],
	[
		"Motocross track",
		4.4,
		49.6,
		104,
	],
	[
		"Fireworks",
		6.1,
		46.2,
		115,
	],
	[
		"Airshow",
		0.2,
		45.7,
		119,
	],
];

const CITIES: readonly [
	number,
	number,
	number,
][] = [
	[
		2.35,
		48.86,
		9,
	],
	[
		4.84,
		45.76,
		5,
	],
	[
		5.37,
		43.3,
		5,
	],
	[
		1.44,
		43.6,
		4,
	],
	[
		-0.58,
		44.84,
		4,
	],
	[
		-1.55,
		47.22,
		3,
	],
	[
		3.06,
		50.63,
		3,
	],
	[
		7.75,
		48.58,
		3,
	],
	[
		7.26,
		43.7,
		3,
	],
];

function round1(v: number): number {
	return Math.round(v * 10) / 10;
}

/** Sensors: city background noise, loud sources fading with the distance, isolated peaks */
export function noiseSensors(background = 40_000, seed = 3): Sensor[] {
	const rnd = prng(seed);
	const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
	const out: Sensor[] = [];
	const total = CITIES.reduce((s, c) => s + c[2], 0);

	// background: traffic in the cities, louder in the centers
	for (let i = 0; i < background; i++) {
		let r = rnd() * total;
		let city = CITIES[0] as [
			number,
			number,
			number,
		];
		for (const c of CITIES) {
			r -= c[2];
			if (r <= 0) {
				city = c;
				break;
			}
		}
		const spread = rnd() < 0.6 ? 0.05 : 0.25;
		const dx = gauss() * spread;
		const dy = gauss() * spread * 0.7;
		const d = Math.hypot(dx, dy);
		out.push({
			x: city[0] + dx,
			y: city[1] + dy,
			id: out.length,
			db: round1(Math.max(32, 68 - d * 60 + gauss() * 4)),
		});
	}

	// loud sources: -6 dB each time the distance doubles (spherical spreading)
	for (const s of SOURCES) {
		out.push({
			x: s.x,
			y: s.y,
			id: out.length,
			db: s.db,
			source: s.name,
		});
		for (let i = 0; i < s.sensors; i++) {
			const dist = Math.abs(gauss()) * s.spread * 0.5;
			const angle = rnd() * Math.PI * 2;
			const ref = s.spread * 0.08;
			const db = s.db - 20 * Math.log10(1 + dist / ref) + gauss() * 1.5;
			out.push({
				x: s.x + Math.cos(angle) * dist,
				y: s.y + Math.sin(angle) * dist * 0.7,
				id: out.length,
				// the source stays the loudest
				db: round1(Math.min(s.db - 1, Math.max(45, db))),
			});
		}
	}

	for (const [name, x, y, db] of PEAKS) {
		out.push({
			x,
			y,
			id: out.length,
			db,
			source: name,
		});
	}

	return out;
}

/** Color of a level */
export function dbColor(db: number): string {
	return db >= 100
		? "#7b1fa2"
		: db >= 85
			? "#d93025"
			: db >= 70
				? "#f29900"
				: db >= 55
					? "#fbbc04"
					: "#1e8e3e";
}

/** Description of a level */
export function dbLabel(db: number): string {
	return db >= 120
		? "Pain threshold"
		: db >= 100
			? "Dangerous"
			: db >= 85
				? "Harmful with long exposure"
				: db >= 70
					? "Loud"
					: db >= 55
						? "Moderate"
						: "Quiet";
}
