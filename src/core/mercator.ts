/**
 * Web Mercator helpers working in normalized "world" coordinates:
 * x and y are in [0, 1], (0, 0) being the north-west corner of the world.
 */

const RAD = Math.PI / 180;

/** Size in CSS pixels of the whole world at the given zoom (256 px tiles). */
export function worldSize(zoom: number): number {
	return 256 * 2 ** zoom;
}

/** Longitude to world x */
export function lngX(lng: number): number {
	return lng / 360 + 0.5;
}

/** Latitude to world y (clamped to [0, 1]) */
export function latY(lat: number): number {
	const sin = Math.sin(lat * RAD);
	const y = 0.5 - (0.25 * Math.log((1 + sin) / (1 - sin))) / Math.PI;
	return y < 0 ? 0 : y > 1 ? 1 : y;
}

/** World x to longitude */
export function xLng(x: number): number {
	return (x - 0.5) * 360;
}

/** World y to latitude */
export function yLat(y: number): number {
	const y2 = ((180 - y * 360) * Math.PI) / 180;
	return (360 * Math.atan(Math.exp(y2))) / Math.PI - 90;
}

/**
 * Abbreviate a point count: 999 => "999", 1250 => "1.3k", 25300 => "25k", 2.5M => "2.5M"
 */
export function abbreviateCount(count: number): string {
	if (count >= 1_000_000) {
		return `${trimZero(Math.round(count / 100_000) / 10)}M`;
	}
	if (count >= 10_000) {
		return `${Math.round(count / 1000)}k`;
	}
	if (count >= 1000) {
		return `${trimZero(Math.round(count / 100) / 10)}k`;
	}
	return String(count);
}

function trimZero(n: number): string {
	return Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1);
}

/**
 * Compute the best integer zoom so that the world bbox fits in a viewport of the given size.
 * @param minX world bbox
 * @param minY world bbox
 * @param maxX world bbox
 * @param maxY world bbox
 * @param width viewport width in CSS px
 * @param height viewport height in CSS px
 * @param maxZoom upper bound
 */
export function fitZoom(
	minX: number,
	minY: number,
	maxX: number,
	maxY: number,
	width: number,
	height: number,
	maxZoom: number,
): number {
	const dx = Math.max(maxX - minX, 1e-12);
	const dy = Math.max(maxY - minY, 1e-12);
	const zx = Math.log2(width / 256 / dx);
	const zy = Math.log2(height / 256 / dy);
	return Math.max(0, Math.min(Math.floor(Math.min(zx, zy)), maxZoom));
}
