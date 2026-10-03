/**
 * Demo fleet: points with a category, and an SVG icon per category
 */

import { type KnIcon, knSvg } from "../src/index.ts";
import { prng, randomPoints } from "./shared.ts";

export type CategoryId = "car" | "truck" | "alert" | "home" | "person" | "bolt";

export interface Category {
	readonly id: CategoryId;
	readonly name: string;
	readonly color: string;
	readonly icon: KnIcon;
}

export const CATEGORIES: readonly Category[] = [
	{
		id: "car",
		name: "Car",
		color: "#1a73e8",
		icon: knSvg.pin({
			color: "#1a73e8",
			glyph: "car",
		}),
	},
	{
		id: "truck",
		name: "Truck",
		color: "#6a1b9a",
		icon: knSvg.pin({
			color: "#6a1b9a",
			glyph: "truck",
		}),
	},
	{
		id: "alert",
		name: "Alert",
		color: "#d93025",
		icon: knSvg.pin({
			color: "#d93025",
			glyph: "alert",
			size: 44,
		}),
	},
	{
		id: "home",
		name: "Depot",
		color: "#1e8e3e",
		icon: knSvg.badge({
			color: "#1e8e3e",
			glyph: "home",
			shape: "square",
		}),
	},
	{
		id: "person",
		name: "Technician",
		color: "#f29900",
		icon: knSvg.badge({
			color: "#f29900",
			glyph: "person",
		}),
	},
	{
		id: "bolt",
		name: "Charging station",
		color: "#00897b",
		icon: knSvg.badge({
			color: "#00897b",
			glyph: "bolt",
			size: 26,
		}),
	},
];

export interface FleetPoint {
	x: number;
	y: number;
	id: number;
	category: CategoryId;
	speed: number;
}

const ICONS = new Map<string, KnIcon>(
	CATEGORIES.map((c) => [
		c.id,
		c.icon,
	]),
);

/** Icon of a point (the same object for every point of a category) */
export function fleetIcon(p: FleetPoint): KnIcon {
	return ICONS.get(p.category) as KnIcon;
}

/** Random fleet around french cities */
export function fleetPoints(count: number, seed = 1): FleetPoint[] {
	const rnd = prng(seed + 1000);
	return randomPoints(count, seed).map((p) => {
		const r = rnd();
		const category: CategoryId =
			r < 0.4
				? "car"
				: r < 0.6
					? "truck"
					: r < 0.65
						? "alert"
						: r < 0.75
							? "home"
							: r < 0.9
								? "person"
								: "bolt";
		return {
			x: p.x,
			y: p.y,
			id: p.id,
			category,
			speed: Math.round(rnd() * 110),
		};
	});
}

/** Data URL of an icon (for the HTML gallery) */
export function iconUrl(icon: KnIcon): string {
	const url = typeof icon === "string" ? icon : "url" in icon ? icon.url : "";
	return url.startsWith("<svg")
		? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(url)}`
		: url;
}
