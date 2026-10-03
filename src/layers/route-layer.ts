/**
 * KnRouteLayer: a route (polyline) drawn with WebGL2
 * - direction arrows at a constant spacing in pixels,
 * - Douglas-Peucker simplification precomputed for every zoom,
 * - intermediate points visible from a zoom level, pinned points always visible,
 * - per segment color (speed...).
 */

import { encode } from "../core/cluster-index.ts";
import { buildGrid, SpatialGrid } from "../core/grid.ts";
import { latY, lngX } from "../core/mercator.ts";
import { type KnRouteStats, routeStats } from "../core/route-stats.ts";
import { simplifiedIndices } from "../core/simplify.ts";
import { whenMapReadyForViewport } from "../maps/ready.ts";
import { parseColor, WHITE } from "../render/color.ts";
import type { AtlasEntry } from "../render/gl/atlas.ts";
import { InstanceBuffer } from "../render/gl/instances.ts";
import { LINE, SPRITE } from "../render/gl/layouts.ts";
import type { Renderer } from "../render/gl/renderer.ts";
import { HitList } from "../render/hits.ts";
import { getArrow, getIcon, iconKey, type KnIcon } from "../render/icons.ts";
import {
	type KnInfoContent,
	KnInfoWindow,
	type KnInfoWindowOptions,
} from "../render/info-window.ts";
import { KnOverlay, type KnPointer, type OverlayLayer } from "../render/overlay.ts";
import type { KnView } from "../render/view.ts";
import { pushLine, pushSprite } from "../render/write.ts";
import type { KnEventBase, KnPoint } from "../types.ts";
import { runInWorker } from "../worker/client.ts";

export interface KnRouteEvent<T> extends KnEventBase {
	readonly type: "route-point";
	readonly point: T;
	/** index of the point in the route */
	readonly index: number;
}

export interface KnRouteArrows {
	/** distance between two arrows in CSS px (default 70) */
	readonly spacing?: number;
	/** arrow size in CSS px (default: 2.7 x the line width, min 16) */
	readonly size?: number;
	/** arrow color (default white) */
	readonly color?: string;
	/** arrow outline color (default semi-transparent black) */
	readonly outline?: string;
}

export interface KnRoutePoints<T> {
	/** zoom from which the intermediate points are visible (default 15) */
	readonly minZoom?: number;
	/** icon of the intermediate points (default: small circle of the route color) */
	readonly icon?: KnIcon | ((point: T, index: number) => KnIcon);
}

export interface KnRouteOptions<T extends KnPoint> {
	/** line color, or color of each segment (from point a to point b) */
	readonly color?: string | ((a: T, b: T, index: number) => string);
	/** line width in CSS px (default 6) */
	readonly width?: number;
	/** border drawn below the line, false to disable (default 1.5 px white) */
	readonly outline?:
		| {
				readonly color?: string;
				readonly width?: number;
		  }
		| false;
	/** direction arrows, false to disable */
	readonly arrows?: KnRouteArrows | false;
	/** intermediate points, false to never show them */
	readonly points?: KnRoutePoints<T> | false;
	/** always visible points (default: first and last point) */
	readonly pinned?: (point: T, index: number, all: readonly T[]) => boolean;
	/** icon of the pinned points (default: green pin for the start, red for the end, orange else) */
	readonly pinnedIcon?: (point: T, index: number, all: readonly T[]) => KnIcon;
	/** simplification tolerance in CSS px, 0 to disable (default 0.5) */
	readonly simplify?: number;
	/** fit the map to the route on load (default true) */
	readonly fit?: boolean;
	/** simplify in a Web Worker: 'auto' (default) above 50k points */
	readonly worker?: "auto" | boolean;
	/** drawing order between the layers of the map (default -10: below the clusterers) */
	readonly zIndex?: number;
	/** click on a point (intermediate or pinned) */
	readonly onPointClick?: (e: KnRouteEvent<T>) => void;
	/** pointer entering (event) or leaving (null) a point */
	readonly onHover?: (e: KnRouteEvent<T> | null) => void;
	/** content of the info window opened when a point is clicked (null: no info window) */
	readonly infoWindow?: (e: KnRouteEvent<T>) => KnInfoContent;
	/** info window appearance (CSS class, max width, close button, auto pan) */
	readonly infoWindowOptions?: KnInfoWindowOptions;
	/** time of a point (Date, ms since epoch or date string): enables the durations and speeds of getStats() */
	readonly time?: (point: T) => Date | number | string | null | undefined;
	/** speed of a point in km/h (ex: GPS speed), used for the max speed of getStats() */
	readonly speed?: (point: T) => number | null | undefined;
	/** below this speed (km/h) a segment is a stop, for the moving duration (default 2) */
	readonly stopSpeed?: number;
}

const DEFAULT_COLOR = "#1a73e8";
const WORKER_THRESHOLD = 50_000;
/** max number of arrows drawn */
const MAX_ARROWS = 20_000;

/**
 * A route drawn with WebGL2.
 *
 * @example
 * const route = new KnRouteLayer(map, { color: '#1a73e8', arrows: { spacing: 80 } });
 * route.load(points); // [{ x: lng, y: lat, ...custom properties }]
 */
export class KnRouteLayer<T extends KnPoint = KnPoint> {
	readonly map: google.maps.Map;
	private opts: KnRouteOptions<T>;
	private readonly overlay: KnOverlay;
	private readonly layer: OverlayLayer;
	private loadToken = 0;

	// data
	private points: readonly T[] = [];
	private wx: Float64Array = new Float64Array(0);
	private wy: Float64Array = new Float64Array(0);
	private importance: Float64Array = new Float64Array(0);
	private colors = new Uint32Array(0);
	private grid: SpatialGrid | null = null;
	private pinned: number[] = [];

	// render state
	private readonly lines = new InstanceBuffer(LINE);
	private readonly arrows = new InstanceBuffer(SPRITE);
	private readonly sprites = new InstanceBuffer(SPRITE);
	private readonly hits = new HitList();
	private dirty = true;
	private atlasGen = -1;
	private lineZoom = Number.NaN;
	private spriteZoom = Number.NaN;
	private box:
		| [
				number,
				number,
				number,
				number,
		  ]
		| null = null;
	/** simplified vertices of the current zoom, and their cumulative distance */
	private kept: number[] = [];
	private cum: Float64Array = new Float64Array(0);
	private renderer: Renderer | null = null;
	private readonly info: KnInfoWindow;
	private infoOpen = false;
	private stats: KnRouteStats | null = null;

	constructor(map: google.maps.Map, options: KnRouteOptions<T> = {}) {
		this.map = map;
		this.opts = options;
		this.overlay = KnOverlay.for(map);
		this.info = KnInfoWindow.for(map);
		const self = this;
		this.layer = {
			get zIndex(): number {
				return self.opts.zIndex ?? -10;
			},
			render: (r, view) => this.render(r, view),
			hitTest: (view, x, y) => this.hits.find(view, x, y, 2),
			click: (hit, e) => {
				const ev = this.event(hit, e);
				if (ev) {
					this.opts.onPointClick?.(ev);
					const content = this.opts.infoWindow?.(ev);
					if (content) {
						this.openInfoWindow(content, ev.point, this.hits.top(hit));
					}
				}
			},
			hover: (hit, e) => this.opts.onHover?.(hit >= 0 ? this.event(hit, e) : null),
			invalidate: () => {
				this.dirty = true;
			},
			destroy: () => this.destroy(),
		};
		this.overlay.add(this.layer);
	}

	/** Current options */
	get options(): KnRouteOptions<T> {
		return this.opts;
	}

	/**
	 * Load the points of the route (in order)
	 * @returns resolved once the route is drawn
	 */
	async load(
		points: readonly T[],
		options: {
			readonly fit?: boolean;
		} = {},
	): Promise<void> {
		const token = ++this.loadToken;
		const n = points.length;
		const wx = new Float64Array(n);
		const wy = new Float64Array(n);
		for (let i = 0; i < n; i++) {
			const p = points[i] as T;
			wx[i] = lngX(p.x);
			wy[i] = latY(p.y);
		}

		if (options.fit ?? this.opts.fit ?? true) {
			this.fitBounds(points);
		}

		let importance: Float64Array;
		if ((this.opts.simplify ?? 0.5) > 0 && n > 2) {
			const worker = this.opts.worker ?? "auto";
			const result = await runInWorker(
				() => ({
					type: "simplify",
					xs: wx.slice(),
					ys: wy.slice(),
				}),
				worker === "auto" ? n > WORKER_THRESHOLD : worker,
			);
			if (token !== this.loadToken || result.type !== "simplify") {
				return;
			}
			importance = result.importance;
		} else {
			importance = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
		}

		this.points = points;
		this.wx = wx;
		this.wy = wy;
		this.importance = importance;
		this.prepare();
	}

	/** Update some options */
	setOptions(options: Partial<KnRouteOptions<T>>): void {
		this.opts = {
			...this.opts,
			...options,
		};
		if ("zIndex" in options) {
			this.overlay.sort();
		}
		this.prepare();
	}

	/** Remove the route */
	clear(): void {
		this.loadToken++;
		this.points = [];
		this.wx = new Float64Array(0);
		this.wy = new Float64Array(0);
		this.importance = new Float64Array(0);
		this.prepare();
	}

	/** Remove the layer from the map */
	destroy(): void {
		this.clear();
		this.closeInfoWindow();
		this.overlay.remove(this.layer);
		if (this.renderer) {
			for (const b of [
				this.lines,
				this.arrows,
				this.sprites,
			]) {
				this.renderer.release(b);
			}
		}
	}

	/** Points of the route */
	getPoints(): readonly T[] {
		return this.points;
	}

	/**
	 * Statistics of the route: distance (m), durations (ms) and speeds (km/h).
	 * Durations and speeds need the `time` option (null otherwise), the max speed uses the
	 * `speed` option when given (GPS speed), else the speed between the points.
	 */
	getStats(): KnRouteStats {
		this.stats ??= routeStats(this.points, {
			time: this.opts.time,
			speed: this.opts.speed,
			stopSpeed: this.opts.stopSpeed,
		});
		return this.stats;
	}

	/**
	 * Open the info window of the layer
	 * @param position x = longitude, y = latitude
	 * @param offset pixel offset of the tip (ex: [0, -40] for a 40 px high pin)
	 */
	openInfoWindow(
		content: string | Node,
		position: KnPoint,
		offset?: readonly [
			number,
			number,
		],
	): void {
		this.infoOpen = true;
		this.info.open(content, position, {
			...this.opts.infoWindowOptions,
			...(offset
				? {
						offset,
					}
				: {}),
			onClose: () => {
				this.infoOpen = false;
			},
		});
	}

	/** Close the info window if it was opened by this layer */
	closeInfoWindow(): void {
		if (this.infoOpen) {
			this.info.close();
		}
	}

	/** Fit the map to the route */
	fitBounds(
		points: readonly T[] = this.points,
		padding: number | google.maps.Padding = 40,
	): void {
		if (points.length === 0) {
			return;
		}
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		for (const p of points) {
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minY = Math.min(minY, p.y);
			maxY = Math.max(maxY, p.y);
		}
		whenMapReadyForViewport(this.map, () =>
			this.map.fitBounds(
				{
					west: minX,
					south: minY,
					east: maxX,
					north: maxY,
				},
				padding,
			),
		);
	}

	/** Derived data: colors, pinned points, spatial index */
	private prepare(): void {
		const points = this.points;
		this.stats = null;
		const n = points.length;
		const color = this.opts.color ?? DEFAULT_COLOR;

		this.colors = new Uint32Array(Math.max(0, n - 1));
		if (typeof color === "function") {
			for (let i = 0; i < n - 1; i++) {
				this.colors[i] = parseColor(color(points[i] as T, points[i + 1] as T, i));
			}
		} else {
			this.colors.fill(parseColor(color));
		}

		const pinned = this.opts.pinned ?? ((_p: T, i: number) => i === 0 || i === n - 1);
		this.pinned = [];
		for (let i = 0; i < n; i++) {
			if (pinned(points[i] as T, i, points)) {
				this.pinned.push(i);
			}
		}

		// spatial index of the points (int32 coords, cell ~ 64 px at zoom 15)
		const coords = new Int32Array(n * 2);
		for (let i = 0; i < n; i++) {
			coords[2 * i] = encode(this.wx[i] as number);
			coords[2 * i + 1] = encode(this.wy[i] as number);
		}
		this.grid = new SpatialGrid(
			buildGrid(coords, 2, n, (64 / (256 * 2 ** 15)) * 2 ** 30),
			coords,
			2,
		);

		this.lineZoom = Number.NaN;
		this.dirty = true;
		this.overlay.requestRender();
	}

	// ---------------------------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------------------------

	private render(r: Renderer, view: KnView): boolean {
		this.renderer = r;
		const zoom = Math.floor(view.zoom);
		const atlasChanged = r.atlas.generation !== this.atlasGen;

		if (zoom !== this.lineZoom || this.dirty) {
			this.rebuildLines(zoom);
		}

		const box = this.box;
		const inside =
			box !== null &&
			view.minX >= box[0] &&
			view.minY >= box[1] &&
			view.maxX <= box[2] &&
			view.maxY <= box[3];
		if (this.dirty || atlasChanged || !inside || view.zoom !== this.spriteZoom) {
			this.spriteZoom = view.zoom;
			const gen = r.atlas.generation;
			this.rebuildSprites(r, view);
			if (r.atlas.generation !== gen) {
				this.rebuildSprites(r, view);
			}
		}

		const width = this.opts.width ?? 6;
		const outline = this.opts.outline ?? {};
		if (outline !== false) {
			const c = parseColor(outline.color ?? "rgba(255,255,255,0.9)");
			r.drawLines(this.lines, {
				widthAdd: width - 1 + 2 * (outline.width ?? 1.5),
				color: [
					(c & 255) / 255,
					((c >>> 8) & 255) / 255,
					((c >>> 16) & 255) / 255,
					(c >>> 24) / 255,
				],
			});
		}
		r.drawLines(this.lines, {
			widthAdd: width - 1,
		});
		r.drawSprites(this.arrows);
		r.drawSprites(this.sprites);
		return false;
	}

	/** Simplified line for a zoom */
	private rebuildLines(zoom: number): void {
		this.lineZoom = zoom;
		this.lines.clear();
		const n = this.points.length;
		if (n < 2) {
			this.kept = [];
			this.cum = new Float64Array(0);
			return;
		}

		const tolerance = (this.opts.simplify ?? 0.5) / (256 * 2 ** zoom);
		const kept = simplifiedIndices(this.importance, tolerance);
		const cum = new Float64Array(kept.length);
		const { wx, wy } = this;

		for (let j = 1; j < kept.length; j++) {
			const a = kept[j - 1] as number;
			const b = kept[j] as number;
			const ax = wx[a] as number;
			const ay = wy[a] as number;
			const bx = wx[b] as number;
			const by = wy[b] as number;
			cum[j] = (cum[j - 1] as number) + Math.hypot(bx - ax, by - ay);
			// line width is set by the draw call (widthAdd), the instances have width 1
			pushLine(this.lines, ax, ay, bx, by, this.colors[a] as number, 1);
		}

		this.kept = kept;
		this.cum = cum;
	}

	/** Arrows (visible part), points and pinned points */
	private rebuildSprites(r: Renderer, view: KnView): void {
		const atlas = r.atlas;
		this.dirty = false;
		this.atlasGen = atlas.generation;
		this.arrows.clear();
		this.sprites.clear();
		this.hits.clear();

		const pw = (view.maxX - view.minX) * 0.5;
		const ph = (view.maxY - view.minY) * 0.5;
		const box: [
			number,
			number,
			number,
			number,
		] = [
			view.minX - pw,
			view.minY - ph,
			view.maxX + pw,
			view.maxY + ph,
		];
		this.box = box;

		this.rebuildArrows(r, view, box);

		// intermediate points
		const po = this.opts.points ?? {};
		if (po !== false && view.zoom >= (po.minZoom ?? 15) && this.grid) {
			const ids: number[] = [];
			const scale = 2 ** 30;
			this.grid.range(
				(box[0] - 0.5) * scale,
				(box[1] - 0.5) * scale,
				(box[2] - 0.5) * scale,
				(box[3] - 0.5) * scale,
				ids,
			);
			ids.sort((a, b) => a - b);
			const pinnedSet = new Set(this.pinned);
			for (const i of ids) {
				if (!pinnedSet.has(i)) {
					this.pushPoint(r, i, this.pointIcon(i, po));
				}
			}
		}

		// pinned points, on top
		for (const i of this.pinned) {
			this.pushPoint(r, i, this.pinnedIcon(i));
		}
	}

	private rebuildArrows(
		r: Renderer,
		view: KnView,
		box: [
			number,
			number,
			number,
			number,
		],
	): void {
		const a = this.opts.arrows ?? {};
		const kept = this.kept;
		if (a === false || kept.length < 2) {
			return;
		}

		const spacing = (a.spacing ?? 70) / view.scale;
		const entry = getArrow(
			r.atlas,
			a.size ?? Math.max(16, Math.round((this.opts.width ?? 6) * 2.7)),
			a.color ?? "#fff",
			a.outline ?? "rgba(0,0,0,0.7)",
		);
		const color = WHITE;
		const { wx, wy, cum } = this;
		let count = 0;

		for (let j = 1; j < kept.length && count < MAX_ARROWS; j++) {
			const i0 = kept[j - 1] as number;
			const i1 = kept[j] as number;
			const ax = wx[i0] as number;
			const ay = wy[i0] as number;
			const bx = wx[i1] as number;
			const by = wy[i1] as number;

			// segment outside of the box
			if (
				Math.max(ax, bx) < box[0] ||
				Math.min(ax, bx) > box[2] ||
				Math.max(ay, by) < box[1] ||
				Math.min(ay, by) > box[3]
			) {
				continue;
			}

			const d0 = cum[j - 1] as number;
			const d1 = cum[j] as number;
			const len = d1 - d0;
			if (len <= 0) {
				continue;
			}
			const rotation = Math.atan2(by - ay, bx - ax);
			// arrows at constant distance from the start of the route (stable when panning)
			for (
				let k = Math.ceil((d0 + spacing / 2) / spacing);
				k * spacing - spacing / 2 < d1;
				k++
			) {
				const t = (k * spacing - spacing / 2 - d0) / len;
				if (t < 0 || t > 1) {
					continue;
				}
				pushSprite(
					this.arrows,
					ax + (bx - ax) * t,
					ay + (by - ay) * t,
					entry,
					0,
					0,
					color,
					rotation,
				);
				if (++count >= MAX_ARROWS) {
					break;
				}
			}
		}
	}

	private pointIcon(i: number, po: KnRoutePoints<T>): KnIcon {
		const icon = po.icon;
		if (typeof icon === "function") {
			return icon(this.points[i] as T, i);
		}
		if (icon) {
			return icon;
		}
		const color = this.opts.color;
		return {
			circle: typeof color === "string" ? color : DEFAULT_COLOR,
			radius: 4,
			strokeWidth: 2,
		};
	}

	private pinnedIcon(i: number): KnIcon {
		const custom = this.opts.pinnedIcon;
		if (custom) {
			return custom(this.points[i] as T, i, this.points);
		}
		const last = this.points.length - 1;
		return {
			pin: i === 0 ? "#1e8e3e" : i === last ? "#d93025" : "#f29900",
		};
	}

	private pushPoint(r: Renderer, i: number, icon: KnIcon): void {
		const e: AtlasEntry | null = getIcon(r.atlas, icon, iconKey(icon));
		if (!e) {
			return;
		}
		const x = this.wx[i] as number;
		const y = this.wy[i] as number;
		pushSprite(this.sprites, x, y, e, 0, 0, WHITE);
		this.hits.add(
			x,
			y,
			-e.anchorX,
			-e.anchorY,
			e.width - e.anchorX,
			e.height - e.anchorY,
			0,
			i,
		);
	}

	private event(hit: number, e: KnPointer | null): KnRouteEvent<T> | null {
		const index = this.hits.ref(hit);
		const point = this.points[index];
		if (point === undefined) {
			return null;
		}
		return {
			type: "route-point",
			point,
			index,
			latLng: e?.latLng ?? null,
			domEvent: e?.domEvent ?? null,
		};
	}
}
