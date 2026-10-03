/**
 * Google Static Maps URLs (thumbnails)
 */

export interface KnStaticMarker {
	/** longitude */
	readonly x: number;
	/** latitude */
	readonly y: number;
	/** 0xRRGGBB or a color name (default 0xD43333) */
	readonly color?: string;
	readonly size?: "tiny" | "small" | "mid";
	/** single uppercase letter or digit */
	readonly label?: string;
}

export interface KnStaticMapOptions {
	/** image size in px (default [458, 250]) */
	readonly size?: readonly [
		number,
		number,
	];
	/** default 'satellite' */
	readonly maptype?: "roadmap" | "satellite" | "terrain" | "hybrid";
	/** default: automatic (fits the markers) */
	readonly zoom?: number;
	/** 1 or 2 (default 1) */
	readonly scale?: 1 | 2;
	/** default 'png' */
	readonly format?: "png" | "png32" | "gif" | "jpg" | "jpg-baseline";
	/** default: one marker on the point (size mid, color 0xD43333) */
	readonly markers?: readonly KnStaticMarker[];
	/** language of the labels */
	readonly language?: string;
}

function markerParam(m: KnStaticMarker): string {
	const parts = [
		`size:${m.size ?? "mid"}`,
		`color:${m.color ?? "0xD43333"}`,
	];
	if (m.label) {
		parts.push(`label:${m.label}`);
	}
	parts.push(`${m.y},${m.x}`);
	return parts.join("|");
}

/**
 * URL of a static image centered on a point (ex: thumbnail of an alarm)
 * @param point x = longitude, y = latitude
 */
export function staticMapUrl(
	apiKey: string,
	point: {
		readonly x: number;
		readonly y: number;
	},
	options: KnStaticMapOptions = {},
): string {
	const [w, h] = options.size ?? [
		458,
		250,
	];
	const params = new URLSearchParams({
		size: `${w}x${h}`,
		scale: String(options.scale ?? 1),
		maptype: options.maptype ?? "satellite",
		format: options.format ?? "png",
	});
	// without zoom, the image is fitted to the markers
	if (options.zoom !== undefined) {
		params.set("center", `${point.y},${point.x}`);
		params.set("zoom", String(options.zoom));
	}
	if (options.language) {
		params.set("language", options.language);
	}
	for (const m of options.markers ?? [
		{
			x: point.x,
			y: point.y,
		},
	]) {
		params.append("markers", markerParam(m));
	}
	params.set("key", apiKey);
	return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}
