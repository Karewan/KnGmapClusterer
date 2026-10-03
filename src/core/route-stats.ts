/**
 * Route statistics: distance, duration, speeds
 */

export interface KnRouteStats {
	/** number of points */
	readonly points: number;
	/** total distance in meters */
	readonly distance: number;
	/** total duration in ms (null without times) */
	readonly duration: number | null;
	/** duration in movement in ms: segments faster than the stop threshold (null without times) */
	readonly movingDuration: number | null;
	/** distance / duration, in km/h (null without times) */
	readonly averageSpeed: number | null;
	/** distance / moving duration, in km/h (null without times) */
	readonly averageMovingSpeed: number | null;
	/** max speed in km/h: max of the provided speeds, or of the segments speeds (null if unknown) */
	readonly maxSpeed: number | null;
	/** time of the first and last points (ms since epoch, null without times) */
	readonly start: number | null;
	readonly end: number | null;
}

export interface RouteStatsOptions<T> {
	/** time of a point: Date, ms since epoch or a date string */
	readonly time?: ((point: T) => Date | number | string | null | undefined) | undefined;
	/** speed of a point in km/h (ex: GPS speed), used for the max speed */
	readonly speed?: ((point: T) => number | null | undefined) | undefined;
	/** below this speed (km/h) a segment is a stop (default 2) */
	readonly stopSpeed?: number | undefined;
}

const EARTH_RADIUS = 6_371_008.8;
const RAD = Math.PI / 180;

/** Great circle distance in meters between two points (x = longitude, y = latitude) */
export function haversine(ax: number, ay: number, bx: number, by: number): number {
	const dLat = (by - ay) * RAD;
	const dLng = (bx - ax) * RAD;
	const s =
		Math.sin(dLat / 2) ** 2 + Math.cos(ay * RAD) * Math.cos(by * RAD) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(s)));
}

function toMs(v: Date | number | string | null | undefined): number | null {
	if (v === null || v === undefined) {
		return null;
	}
	const ms = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
	return Number.isFinite(ms) ? ms : null;
}

/**
 * Compute the statistics of a route
 */
export function routeStats<
	T extends {
		readonly x: number;
		readonly y: number;
	},
>(points: readonly T[], options: RouteStatsOptions<T> = {}): KnRouteStats {
	const n = points.length;
	const stopSpeed = options.stopSpeed ?? 2;
	const times = options.time ? points.map((p) => toMs(options.time?.(p))) : null;

	let distance = 0;
	let moving = 0;
	let maxSegmentSpeed = -1;
	let hasTimes = times !== null;

	for (let i = 1; i < n; i++) {
		const a = points[i - 1] as T;
		const b = points[i] as T;
		const d = haversine(a.x, a.y, b.x, b.y);
		distance += d;

		if (times) {
			const ta = times[i - 1];
			const tb = times[i];
			if (ta === null || ta === undefined || tb === null || tb === undefined) {
				hasTimes = false;
				continue;
			}
			const dt = tb - ta;
			if (dt > 0) {
				const speed = d / 1000 / (dt / 3_600_000);
				if (speed >= stopSpeed) {
					moving += dt;
				}
				maxSegmentSpeed = Math.max(maxSegmentSpeed, speed);
			}
		}
	}

	let maxSpeed: number | null = null;
	if (options.speed) {
		for (const p of points) {
			const s = options.speed(p);
			if (typeof s === "number" && Number.isFinite(s)) {
				maxSpeed = maxSpeed === null ? s : Math.max(maxSpeed, s);
			}
		}
	}
	if (maxSpeed === null && maxSegmentSpeed >= 0) {
		maxSpeed = maxSegmentSpeed;
	}

	const start = hasTimes && times && n > 0 ? (times[0] ?? null) : null;
	const end = hasTimes && times && n > 0 ? (times[n - 1] ?? null) : null;
	const duration = start !== null && end !== null ? end - start : null;
	const kmh = (ms: number | null): number | null =>
		ms !== null && ms > 0 ? distance / 1000 / (ms / 3_600_000) : null;

	return {
		points: n,
		distance,
		duration,
		movingDuration: hasTimes && n > 1 ? moving : null,
		averageSpeed: kmh(duration),
		averageMovingSpeed: hasTimes && n > 1 ? kmh(moving) : null,
		maxSpeed,
		start,
		end,
	};
}
