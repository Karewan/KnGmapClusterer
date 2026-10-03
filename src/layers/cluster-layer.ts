/**
 * KnGmapClusterer: clusters and markers drawn with WebGL2
 */

import {
	type AggPlan,
	EMPTY_PLAN,
	extractAggregates,
	type KnAggregates,
	type KnAggregateValues,
	readAggregates,
} from "../core/aggregate.ts";
import {
	ClusterIndex,
	type ClusterIndexOptions,
	type ClusterLevel,
	decode,
	OFFSET_ID,
	OFFSET_NUM,
	STRIDE,
} from "../core/cluster-index.ts";
import { abbreviateCount, latY, lngX, xLng, yLat } from "../core/mercator.ts";
import { whenMapReadyForViewport } from "../maps/ready.ts";
import { parseColor, WHITE } from "../render/color.ts";
import type { AtlasEntry } from "../render/gl/atlas.ts";
import { InstanceBuffer } from "../render/gl/instances.ts";
import { CIRCLE, LINE, SPRITE } from "../render/gl/layouts.ts";
import type { Renderer } from "../render/gl/renderer.ts";
import { HitList } from "../render/hits.ts";
import {
	getIcon,
	getText,
	iconKey,
	type KnFont,
	type KnIcon,
	type ResolvedFont,
	resolveFont,
} from "../render/icons.ts";
import {
	type KnInfoContent,
	type KnInfoNav,
	KnInfoWindow,
	type KnInfoWindowOptions,
} from "../render/info-window.ts";
import { KnOverlay, type KnPointer, type OverlayLayer } from "../render/overlay.ts";
import { spiderOffsets } from "../render/spider.ts";
import { type KnView, queryBoxes } from "../render/view.ts";
import { type Anim, type CircleStyle, pushCircle, pushLine, pushSprite } from "../render/write.ts";
import type {
	KnCluster,
	KnClusterEvent,
	KnClusterStyle,
	KnDonutOptions,
	KnHoverEvent,
	KnMarkerEvent,
	KnPoint,
} from "../types.ts";
import { VERSION } from "../version.ts";
import { runInWorker } from "../worker/client.ts";

export interface KnMarkerOptions<T> {
	/** icon of the markers (default: a pin of the `color` color) */
	readonly icon?: KnIcon | ((point: T) => KnIcon);
	/** color of the default pin icon */
	readonly color?: string | ((point: T) => string);
	/** label displayed on the marker (default: the `label` property of the point) */
	readonly label?: (point: T) => string | number | null | undefined;
	/** label font */
	readonly font?: KnFont;
}

export interface KnClusterOptions<A> {
	/** dynamic style of each cluster */
	readonly style?: (cluster: KnCluster<A>) => KnClusterStyle;
	/** default fill color */
	readonly color?: string;
	/** default border color */
	readonly borderColor?: string;
	/** default border width in CSS px */
	readonly borderWidth?: number;
	/** default diameter: [min, max] in CSS px, scaled with the log of the count */
	readonly size?: readonly [
		number,
		number,
	];
	/** default font of the count */
	readonly font?: KnFont;
	/** donut showing the categories of a countBy aggregate */
	readonly donut?: KnDonutOptions;
}

export interface KnClustererOptions<T extends KnPoint, A extends KnAggregates<T>> {
	/** min zoom to generate clusters on (default 0) */
	readonly minZoom?: number;
	/** max zoom level to cluster the points on (default 16) */
	readonly maxZoom?: number;
	/** minimum points to form a cluster (default 2) */
	readonly minPoints?: number;
	/** cluster radius in pixels (default 60) */
	readonly radius?: number;
	/** tile extent, the radius is relative to it (default 256) */
	readonly extent?: number;
	/** clusters options, false to disable the clustering (every point is drawn) */
	readonly cluster?: KnClusterOptions<A> | false;
	/** markers options */
	readonly marker?: KnMarkerOptions<T>;
	/** declarative aggregates computed on the clusters */
	readonly aggregate?: A;
	/** pinned points are never clustered and always visible */
	readonly pinned?: (point: T, index: number) => boolean;
	/**
	 * points at the exact same position, on click: spread around their position ('spiderfy',
	 * default), browsed in the info window with previous / next buttons ('info'), grouped in a
	 * single event ('merge'), or left as is ('none')
	 */
	readonly duplicates?: "spiderfy" | "info" | "merge" | "none";
	/** extra area queried around the viewport, fraction of its size (default 0.25) */
	readonly padding?: number;
	/** animation duration of the clusters (ms) when zooming, 0 to disable (default 300) */
	readonly animate?: number;
	/** build the index in a Web Worker: 'auto' (default) above 20k points */
	readonly worker?: "auto" | boolean;
	/** fit the map to the points on load (default true) */
	readonly fit?: boolean;
	/** drawing order between the layers of the map (default 0) */
	readonly zIndex?: number;
	/** marker click */
	readonly onMarkerClick?: (e: KnMarkerEvent<T>) => void;
	/** cluster click: 'zoom' (default), a callback, or false */
	readonly onClusterClick?: "zoom" | false | ((e: KnClusterEvent<A>) => void);
	/** pointer entering (event) or leaving (null) a marker or a cluster */
	readonly onHover?: (e: KnHoverEvent<T, A> | null) => void;
	/** content of the info window opened when a marker is clicked (null: no info window) */
	readonly infoWindow?: (e: KnMarkerEvent<T>) => KnInfoContent;
	/** info window appearance (CSS class, max width, close button, auto pan) */
	readonly infoWindowOptions?: KnInfoWindowOptions;
}

export interface KnLoadOptions {
	/** fit the map to the points (default: the `fit` option) */
	readonly fit?: boolean;
}

interface ResolvedClusterStyle {
	readonly circle: CircleStyle | null;
	readonly icon: KnIcon | null;
	readonly size: number;
	readonly text: string | null;
	readonly font: ResolvedFont;
	/** opaque fill color: the text is rasterized over it (sub-pixel anti-aliasing) */
	readonly fillCss: string | null;
}

interface Spider {
	/** world position */
	readonly x: number;
	readonly y: number;
	/** point indices */
	readonly members: readonly number[];
	readonly offsets: Float64Array;
	/** leaf id hidden while the spider is open (-1 for a cluster) */
	readonly leaf: number;
	readonly cluster: number;
}

const KIND_CLUSTER = 0;
const KIND_POINT = 1;
const KIND_PINNED = 2;
const KIND_SPIDER = 3;

const WORKER_THRESHOLD = 20_000;
/** above this number of items, no zoom animation */
const ANIM_LIMIT = 4000;
/** when more than 1 / FULL_LEVEL_RATIO of a level is visible, the whole level is drawn */
const FULL_LEVEL_RATIO = 3;

const DEFAULT_MARKER_FONT: ResolvedFont = {
	color: "#000",
	size: 12,
	family: "Roboto, Arial, sans-serif",
	weight: "bold",
	halo: "#fff",
	haloWidth: 2,
};

const DEFAULT_CLUSTER_FONT: ResolvedFont = {
	color: "#fff",
	size: 13,
	family: "Roboto, Arial, sans-serif",
	weight: "bold",
	halo: null,
	haloWidth: 2,
};

const BADGE_COLOR = "#d93025";

const DEFAULT_BADGE_FONT: ResolvedFont = {
	color: "#fff",
	size: 10,
	family: "Roboto, Arial, sans-serif",
	weight: "bold",
	halo: null,
	haloWidth: 0,
};

const INDEX_OPTIONS = [
	"minZoom",
	"maxZoom",
	"minPoints",
	"radius",
	"extent",
	"aggregate",
	"pinned",
	"duplicates",
] as const;

function defaultLabel(p: unknown): string | number | null | undefined {
	const label = (
		p as {
			label?: unknown;
		}
	).label;
	return typeof label === "string" || typeof label === "number" ? label : null;
}

/**
 * Marker clusterer for Google Maps, rendered with WebGL2.
 *
 * @example
 * const clusterer = new KnGmapClusterer(map, { radius: 60 });
 * clusterer.load(points); // [{ x: lng, y: lat, ...custom properties }]
 */
export class KnGmapClusterer<
	T extends KnPoint = KnPoint,
	A extends KnAggregates<T> = KnAggregates<T>,
> {
	/** Library version */
	static readonly VERSION: string = VERSION;

	readonly map: google.maps.Map;
	private opts: KnClustererOptions<T, A>;
	private readonly overlay: KnOverlay;
	private readonly layer: OverlayLayer;

	/** last loaded points (index being built) */
	private source: readonly T[] = [];
	/** points of the current index */
	private points: readonly T[] = [];
	private filter: ((point: T, index: number) => boolean) | null = null;
	private index: ClusterIndex | null = null;
	private plan: AggPlan = EMPTY_PLAN;
	/** input row => point index */
	private rowToPoint: Uint32Array = new Uint32Array(0);
	/** point index => input row (-1 if pinned or filtered) */
	private pointToRow: Int32Array = new Int32Array(0);
	private pinnedPoints: number[] = [];
	private loadToken = 0;
	/** world coordinates of every point */
	private wx: Float64Array = new Float64Array(0);
	private wy: Float64Array = new Float64Array(0);
	private coordsOf: readonly T[] | null = null;
	/** resolved icons and labels of the points (for the atlas generation cacheGen) */
	private iconCache: (AtlasEntry | null | undefined)[] = [];
	private labelCache: (AtlasEntry | null | undefined)[] = [];
	private cacheGen = -1;
	private font: ResolvedFont | null = null;

	// render state
	private readonly circles = new InstanceBuffer(CIRCLE);
	/** badges of the grouped duplicates, above the markers */
	private readonly badges = new InstanceBuffer(CIRCLE);
	private readonly sprites = new InstanceBuffer(SPRITE);
	private readonly spiderLines = new InstanceBuffer(LINE);
	private readonly spiderCircles = new InstanceBuffer(CIRCLE);
	private readonly spiderSprites = new InstanceBuffer(SPRITE);
	private readonly hits = new HitList();
	private readonly info: KnInfoWindow;
	private infoOpen = false;
	private readonly styles = new Map<number, ResolvedClusterStyle>();
	private dirty = true;
	private atlasGen = -1;
	private level: ClusterLevel | null = null;
	private rows: number[] = [];
	private lastZoom = -1;
	private box:
		| [
				number,
				number,
				number,
				number,
		  ]
		| null = null;
	private prevIds = new Set<number>();
	private animStart = 0;
	private spider: Spider | null = null;
	private renderer: Renderer | null = null;

	constructor(map: google.maps.Map, options: KnClustererOptions<T, A> = {}) {
		this.map = map;
		this.opts = options;
		this.overlay = KnOverlay.for(map);
		this.info = KnInfoWindow.for(map);

		this.layer = {
			get zIndex(): number {
				return options.zIndex ?? 0;
			},
			render: (r, view) => this.render(r, view),
			hitTest: (view, x, y) => this.hits.find(view, x, y),
			click: (hit, e) => this.onClick(hit, e),
			hover: (hit, e) => this.onHover(hit, e),
			invalidate: () => {
				this.dirty = true;
			},
			zoomChanged: () => this.closeSpider(),
			clickEmpty: () => this.closeSpider(),
			destroy: () => this.destroy(),
		};
		Object.defineProperty(this.layer, "zIndex", {
			get: () => this.opts.zIndex ?? 0,
		});
		this.overlay.add(this.layer);
	}

	/** Current options */
	get options(): KnClustererOptions<T, A> {
		return this.opts;
	}

	/**
	 * Load the points (replaces the previous ones)
	 * @param points points with x (longitude) and y (latitude), custom properties allowed
	 * @returns resolved once the index is built and the points drawn
	 */
	load(points: readonly T[], options: KnLoadOptions = {}): Promise<void> {
		this.source = points;
		this.closeSpider();
		return this.reindex(options.fit ?? this.opts.fit ?? true);
	}

	/**
	 * Update some options. Options changing the index (radius, zooms, aggregates...)
	 * rebuild it, the others only redraw.
	 */
	setOptions(options: Partial<KnClustererOptions<T, A>>): Promise<void> {
		const prev = this.opts;
		this.opts = {
			...prev,
			...options,
		};

		const reindex =
			INDEX_OPTIONS.some((k) => k in options && options[k] !== prev[k]) ||
			("cluster" in options && (options.cluster === false) !== (prev.cluster === false));

		if ("zIndex" in options) {
			this.overlay.sort();
		}
		if (reindex) {
			return this.reindex(false);
		}
		this.styles.clear();
		this.cacheGen = -1;
		this.dirty = true;
		this.overlay.requestRender();
		return Promise.resolve();
	}

	/**
	 * Only show the points matching a predicate (null to show all of them)
	 */
	setFilter(filter: ((point: T, index: number) => boolean) | null): Promise<void> {
		this.filter = filter;
		this.closeSpider();
		return this.reindex(false);
	}

	/** Remove all the points */
	clear(): void {
		this.loadToken++;
		this.source = [];
		this.points = [];
		this.index = null;
		this.pinnedPoints = [];
		this.rowToPoint = new Uint32Array(0);
		this.pointToRow = new Int32Array(0);
		this.closeSpider();
		this.dirty = true;
		this.overlay.requestRender();
	}

	/**
	 * Add one or several points to the loaded ones (rebuilds the index: for a few points at a time,
	 * use load() to replace many of them)
	 */
	add(...points: T[]): Promise<void> {
		return this.load(
			[
				...this.source,
				...points,
			],
			{
				fit: false,
			},
		);
	}

	/** Remove a point, or the points matching a predicate */
	remove(target: T | ((point: T, index: number) => boolean)): Promise<void> {
		const match =
			typeof target === "function"
				? (target as (point: T, index: number) => boolean)
				: (p: T) => p === target;
		if (this.infoOpen) {
			this.closeInfoWindow();
		}
		return this.load(
			this.source.filter((p, i) => !match(p, i)),
			{
				fit: false,
			},
		);
	}

	/**
	 * Redraw after changing loaded points in place (position, icon, label...)
	 */
	refresh(): Promise<void> {
		this.coordsOf = null;
		this.closeSpider();
		return this.reindex(false);
	}

	/** Remove the clusterer from the map */
	destroy(): void {
		this.clear();
		this.closeInfoWindow();
		this.overlay.remove(this.layer);
		if (this.renderer) {
			for (const b of [
				this.circles,
				this.badges,
				this.sprites,
				this.spiderLines,
				this.spiderCircles,
				this.spiderSprites,
			]) {
				this.renderer.release(b);
			}
		}
	}

	/** Loaded points */
	getPoints(): readonly T[] {
		return this.source;
	}

	/**
	 * Clusters and points currently drawn (viewport + padding)
	 */
	getVisible(): (KnCluster<A> | T)[] {
		const level = this.level;
		const out: (KnCluster<A> | T)[] = [];
		if (level && this.index) {
			for (const k of this.rows) {
				if (this.index.isCluster(level.data, k)) {
					out.push(this.makeCluster(level, k));
				} else {
					for (const p of this.leafPoints(level.data[k + OFFSET_ID] as number)) {
						out.push(this.points[p] as T);
					}
				}
			}
		}
		for (const p of this.pinnedPoints) {
			out.push(this.points[p] as T);
		}
		return out;
	}

	/**
	 * Points of a cluster
	 * @param limit max number of points (default all)
	 * @param offset number of points to skip
	 */
	getLeaves(clusterId: number, limit?: number, offset?: number): T[] {
		if (!this.index) {
			return [];
		}
		return this.index
			.getLeaves(clusterId, limit, offset)
			.map((row) => this.points[this.rowToPoint[row] as number] as T);
	}

	/** Zoom on which a cluster splits */
	getClusterExpansionZoom(clusterId: number): number {
		return this.index ? this.index.getClusterExpansionZoom(clusterId) : 0;
	}

	/** Fit the map to the points */
	fitBounds(padding: number | google.maps.Padding = 40): void {
		let minX = Number.POSITIVE_INFINITY;
		let minY = Number.POSITIVE_INFINITY;
		let maxX = Number.NEGATIVE_INFINITY;
		let maxY = Number.NEGATIVE_INFINITY;
		let count = 0;

		this.source.forEach((p, i) => {
			if (this.filter && !this.filter(p, i)) {
				return;
			}
			minX = Math.min(minX, p.x);
			maxX = Math.max(maxX, p.x);
			minY = Math.min(minY, p.y);
			maxY = Math.max(maxY, p.y);
			count++;
		});

		if (count === 0) {
			return;
		}
		whenMapReadyForViewport(this.map, () => {
			if (minX === maxX && minY === maxY) {
				this.map.setCenter({
					lat: minY,
					lng: minX,
				});
				this.map.setZoom(Math.min(this.opts.maxZoom ?? 16, 16) + 1);
				return;
			}
			this.map.fitBounds(
				{
					west: minX,
					south: minY,
					east: maxX,
					north: maxY,
				},
				padding,
			);
		});
	}

	// ---------------------------------------------------------------------------------------------
	// Index
	// ---------------------------------------------------------------------------------------------

	private indexOptions(): ClusterIndexOptions {
		const o = this.opts;
		const enabled = o.cluster !== false;
		return {
			minZoom: enabled ? (o.minZoom ?? 0) : 0,
			maxZoom: enabled ? (o.maxZoom ?? 16) : -1,
			minPoints: o.minPoints ?? 2,
			radius: o.radius ?? 60,
			extent: o.extent ?? 256,
			groupDuplicates: (o.duplicates ?? "spiderfy") !== "none",
		};
	}

	private async reindex(fit: boolean): Promise<void> {
		const token = ++this.loadToken;
		const points = this.source;
		const pinned = this.opts.pinned;
		const filter = this.filter;

		const rows: number[] = [];
		const pinnedPoints: number[] = [];
		for (let i = 0; i < points.length; i++) {
			const p = points[i] as T;
			if (filter && !filter(p, i)) {
				continue;
			}
			if (pinned?.(p, i)) {
				pinnedPoints.push(i);
			} else {
				rows.push(i);
			}
		}

		// world coordinates, computed once per array of points
		let { wx, wy } = this;
		if (this.coordsOf !== points) {
			wx = new Float64Array(points.length);
			wy = new Float64Array(points.length);
			for (let i = 0; i < points.length; i++) {
				const p = points[i] as T;
				wx[i] = lngX(p.x);
				wy[i] = latY(p.y);
			}
		}

		if (fit) {
			this.fitBounds();
		}

		let index: ClusterIndex | null = null;
		let plan = EMPTY_PLAN;

		if (rows.length > 0) {
			const options = this.indexOptions();
			const createTask = () => {
				const xs = new Float64Array(rows.length);
				const ys = new Float64Array(rows.length);
				for (let r = 0; r < rows.length; r++) {
					const i = rows[r] as number;
					xs[r] = wx[i] as number;
					ys[r] = wy[i] as number;
				}
				const agg = extractAggregates(points, rows, this.opts.aggregate);
				plan = agg.plan;
				return {
					type: "cluster" as const,
					input: {
						xs,
						ys,
						agg: agg.values,
						ops: agg.plan.ops,
					},
					options,
				};
			};

			const worker = this.opts.worker ?? "auto";
			const useWorker = worker === "auto" ? rows.length > WORKER_THRESHOLD : worker;
			const result = await runInWorker(createTask, useWorker);
			if (token !== this.loadToken || result.type !== "cluster") {
				return;
			}
			index = new ClusterIndex(result.data);
		}

		if (token !== this.loadToken) {
			return;
		}

		// the new points are only used with their index
		this.points = points;
		this.coordsOf = points;
		this.wx = wx;
		this.wy = wy;
		this.pinnedPoints = pinnedPoints;
		this.index = index;
		this.plan = plan;
		this.rowToPoint = Uint32Array.from(rows);
		this.pointToRow = new Int32Array(points.length).fill(-1);
		for (let r = 0; r < rows.length; r++) {
			this.pointToRow[rows[r] as number] = r;
		}
		this.cacheGen = -1;
		this.styles.clear();
		this.prevIds.clear();
		this.lastZoom = -1;
		this.level = null;
		this.rows = [];
		this.dirty = true;
		this.overlay.requestRender();
	}

	/** Point indices of a leaf (several when duplicates are grouped) */
	private leafPoints(leafId: number): number[] {
		const rows = this.index
			? this.index.duplicatesOf(leafId)
			: [
					leafId,
				];
		return rows.map((r) => this.rowToPoint[r] as number);
	}

	private makeCluster(level: ClusterLevel, k: number): KnCluster<A> {
		const count = level.data[k + OFFSET_NUM] as number;
		return {
			id: level.data[k + OFFSET_ID] as number,
			x: xLng(decode(level.data[k] as number)),
			y: yLat(decode(level.data[k + 1] as number)),
			count,
			countAbbr: abbreviateCount(count),
			agg: readAggregates(
				this.plan,
				level.agg,
				(k / STRIDE) * this.plan.cols,
				count,
			) as unknown as KnAggregateValues<A>,
		};
	}

	// ---------------------------------------------------------------------------------------------
	// Styles
	// ---------------------------------------------------------------------------------------------

	private clusterStyle(level: ClusterLevel, k: number): ResolvedClusterStyle {
		const id = level.data[k + OFFSET_ID] as number;
		const cached = this.styles.get(id);
		if (cached) {
			return cached;
		}

		const o = this.opts.cluster === false ? {} : (this.opts.cluster ?? {});
		const cluster = this.makeCluster(level, k);
		const custom = o.style?.(cluster) ?? {};

		const [minSize, maxSize] = o.size ?? [
			30,
			60,
		];
		const size =
			custom.size ??
			Math.min(maxSize, minSize + (maxSize - minSize) * (Math.log10(cluster.count) / 4));
		const radius = size / 2;
		const font = resolveFont(custom.font, resolveFont(o.font, DEFAULT_CLUSTER_FONT));
		const text = custom.text === undefined ? cluster.countAbbr : custom.text;

		let circle: CircleStyle | null = null;
		let fillCss: string | null = null;
		if (!custom.icon) {
			fillCss = custom.color ?? o.color ?? "#1a73e8";
			const fill = parseColor(fillCss);
			if (fill >>> 24 !== 255) {
				fillCss = null;
			}
			const stroke = parseColor(
				custom.borderColor ?? o.borderColor ?? "rgba(255,255,255,0.9)",
			);
			let strokeWidth = custom.borderWidth ?? o.borderWidth ?? 2;
			let stops: number[] | null = null;
			let colors: number[] | null = null;

			if (o.donut) {
				const counts = cluster.agg[o.donut.aggregate] as
					| Readonly<Record<string, number>>
					| undefined;
				if (counts && typeof counts === "object") {
					const donut = this.donut(counts, o.donut);
					stops = donut.stops;
					colors = donut.colors;
					strokeWidth = o.donut.width ?? Math.max(4, radius * 0.3);
				}
			}
			circle = {
				radius,
				strokeWidth,
				fill,
				stroke,
				stops,
				colors,
			};
		}

		const style: ResolvedClusterStyle = {
			circle,
			icon: custom.icon ?? null,
			size,
			text,
			font,
			fillCss,
		};
		this.styles.set(id, style);
		return style;
	}

	private donut(
		counts: Readonly<Record<string, number>>,
		opts: KnDonutOptions,
	): {
		stops: number[];
		colors: number[];
	} {
		const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
		const total = entries.reduce((s, e) => s + e[1], 0) || 1;
		const colorOf = (cat: string): number =>
			parseColor(
				typeof opts.colors === "function"
					? opts.colors(cat)
					: (opts.colors[cat] ?? "#9e9e9e"),
			);

		// 3 main categories + others
		const stops: number[] = [];
		const colors: number[] = [];
		let acc = 0;
		for (let i = 0; i < Math.min(3, entries.length); i++) {
			const [cat, n] = entries[i] as [
				string,
				number,
			];
			acc += n / total;
			stops.push(acc);
			colors.push(colorOf(cat));
		}
		if (entries.length > 3) {
			colors.push(parseColor("#9e9e9e"));
		}
		while (stops.length < 3) {
			stops.push(1);
		}
		return {
			stops,
			colors,
		};
	}

	private resetCaches(generation: number): void {
		this.cacheGen = generation;
		this.iconCache = new Array(this.points.length);
		this.labelCache = new Array(this.points.length);
		this.font = null;
	}

	private markerFont(): ResolvedFont {
		this.font ??= resolveFont(this.opts.marker?.font, DEFAULT_MARKER_FONT);
		return this.font;
	}

	private markerIcon(p: T): KnIcon {
		const m = this.opts.marker;
		const icon = typeof m?.icon === "function" ? m.icon(p) : m?.icon;
		if (icon) {
			return icon;
		}
		const color = typeof m?.color === "function" ? m.color(p) : (m?.color ?? "#ea4335");
		return {
			pin: color,
		};
	}

	// ---------------------------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------------------------

	private render(r: Renderer, view: KnView): boolean {
		this.renderer = r;
		const index = this.index;
		const zoom = index ? index.limitZoom(view.zoom) : -1;
		const duration = this.opts.animate ?? 300;
		const t = this.animStart > 0 ? Math.min(1, (view.time - this.animStart) / duration) : 1;

		const box = this.box;
		const inside =
			box !== null &&
			view.minX >= box[0] &&
			view.minY >= box[1] &&
			view.maxX <= box[2] &&
			view.maxY <= box[3];

		if (
			this.dirty ||
			r.atlas.generation !== this.atlasGen ||
			zoom !== this.lastZoom ||
			(!inside && t >= 1)
		) {
			const gen = r.atlas.generation;
			this.rebuild(r, view, zoom);
			if (r.atlas.generation !== gen) {
				// the atlas was full and has been reset during the rebuild
				this.rebuild(r, view, zoom);
			}
		}

		const anim = this.animStart > 0 ? Math.min(1, (view.time - this.animStart) / duration) : 1;
		r.drawCircles(this.circles, {
			anim,
		});
		r.drawSprites(this.sprites, {
			anim,
		});
		r.drawCircles(this.badges, {
			anim,
		});
		if (this.spider) {
			r.drawLines(this.spiderLines);
			r.drawCircles(this.spiderCircles);
			r.drawSprites(this.spiderSprites);
		}
		if (anim >= 1) {
			this.animStart = 0;
		}
		return anim < 1;
	}

	private rebuild(r: Renderer, view: KnView, zoom: number): void {
		const atlas = r.atlas;
		this.dirty = false;
		this.atlasGen = atlas.generation;

		const padding = this.opts.padding ?? 0.25;
		const px = (view.maxX - view.minX) * padding;
		const py = (view.maxY - view.minY) * padding;
		this.box = [
			view.minX - px,
			view.minY - py,
			view.maxX + px,
			view.maxY + py,
		];

		this.circles.clear();
		this.badges.clear();
		this.sprites.clear();
		this.hits.clear();

		const index = this.index;
		const prevZoom = this.lastZoom;
		const ids = new Set<number>();
		let animate = false;
		this.rows = [];
		this.level = null;

		if (index) {
			const level = index.level(zoom);
			let rows: number[] = [];
			const boxes = queryBoxes(view, padding);
			for (const b of boxes) {
				index.range(level, b[0], b[1], b[2], b[3], rows);
			}
			if (boxes.length > 1) {
				rows = [
					...new Set(rows),
				];
			}

			// a big part of the level is visible: draw the whole level once, the GPU clips the rest
			// and panning never needs a rebuild
			if (rows.length * FULL_LEVEL_RATIO > level.grid.numItems) {
				rows = [];
				index.range(level, 0, 0, 1, 1, rows);
				this.box = [
					Number.NEGATIVE_INFINITY,
					Number.NEGATIVE_INFINITY,
					Number.POSITIVE_INFINITY,
					Number.POSITIVE_INFINITY,
				];
			}
			this.level = level;
			this.rows = rows;

			animate =
				prevZoom !== -1 &&
				zoom !== prevZoom &&
				(this.opts.animate ?? 300) > 0 &&
				rows.length <= ANIM_LIMIT;
			if (animate) {
				this.animStart = view.time;
			}
			const trackIds = rows.length <= ANIM_LIMIT;

			// clusters first (drawn below the markers), biggest last
			const clusters: number[] = [];
			const leaves: number[] = [];
			for (const k of this.rows) {
				(index.isCluster(level.data, k) ? clusters : leaves).push(k);
			}
			clusters.sort(
				(a, b) =>
					(level.data[a + OFFSET_NUM] as number) - (level.data[b + OFFSET_NUM] as number),
			);

			for (const k of clusters) {
				const id = level.data[k + OFFSET_ID] as number;
				if (trackIds) {
					ids.add(id);
				}
				this.pushCluster(
					r,
					level,
					k,
					this.animFor(index, level, k, zoom, prevZoom, animate, id),
				);
			}
			for (const k of leaves) {
				const id = level.data[k + OFFSET_ID] as number;
				if (trackIds) {
					ids.add(id);
				}
				if (this.spider?.leaf === id) {
					continue;
				}
				this.pushLeaf(
					r,
					level,
					k,
					this.animFor(index, level, k, zoom, prevZoom, animate, id),
				);
			}
		}

		// pinned points: always visible, on top
		for (const p of this.pinnedPoints) {
			this.pushPoint(r, p, KIND_PINNED, 1, null);
		}

		this.prevIds = ids;
		this.lastZoom = zoom;
		this.rebuildSpider(r, view);
	}

	private animFor(
		index: ClusterIndex,
		level: ClusterLevel,
		k: number,
		zoom: number,
		prevZoom: number,
		animate: boolean,
		id: number,
	): Anim | null {
		if (!animate || this.prevIds.has(id)) {
			return null;
		}
		if (zoom > prevZoom) {
			const from = index.ancestorPosition(zoom, k, prevZoom);
			if (from) {
				return {
					dx: from[0] - decode(level.data[k] as number),
					dy: from[1] - decode(level.data[k + 1] as number),
					fade: false,
				};
			}
		}
		return {
			dx: 0,
			dy: 0,
			fade: true,
		};
	}

	private pushCluster(r: Renderer, level: ClusterLevel, k: number, anim: Anim | null): void {
		const atlas = r.atlas;
		const x = decode(level.data[k] as number);
		const y = decode(level.data[k + 1] as number);
		const style = this.clusterStyle(level, k);
		let half = style.size / 2;
		let textDx = 0;
		let textDy = 0;

		if (style.icon) {
			const e = getIcon(atlas, style.icon);
			if (e) {
				pushSprite(this.sprites, x, y, e, 0, 0, WHITE, 0, anim);
				this.hits.add(
					x,
					y,
					-e.anchorX,
					-e.anchorY,
					e.width - e.anchorX,
					e.height - e.anchorY,
					KIND_CLUSTER,
					k,
				);
				textDx = e.labelX - e.anchorX;
				textDy = e.labelY - e.anchorY;
				half = 0;
			}
		} else if (style.circle) {
			// sharpest text: rasterized over the opaque fill, drawn by the circle shader
			const text =
				style.text && style.fillCss
					? getText(atlas, style.text, style.font, style.fillCss)
					: null;
			pushCircle(this.circles, x, y, style.circle, 0, 0, anim, text);
			this.hits.add(x, y, -half, -half, half, half, KIND_CLUSTER, k);
			if (text) {
				return;
			}
		}

		if (style.text) {
			const e = getText(atlas, style.text, style.font);
			pushSprite(this.sprites, x, y, e, textDx, textDy, WHITE, 0, anim);
		}
	}

	private pushLeaf(r: Renderer, level: ClusterLevel, k: number, anim: Anim | null): void {
		const leafId = level.data[k + OFFSET_ID] as number;
		const weight = level.data[k + OFFSET_NUM] as number;
		const point = this.rowToPoint[leafId] as number;
		this.pushPoint(r, point, KIND_POINT, weight, anim);
	}

	/**
	 * Draw a marker
	 * @param weight number of points at this position (badge when > 1)
	 */
	private pushPoint(
		r: Renderer,
		pointIndex: number,
		kind: number,
		weight: number,
		anim: Anim | null,
		dx = 0,
		dy = 0,
		sprites: InstanceBuffer = this.sprites,
		badges: InstanceBuffer = this.badges,
		ref: number = pointIndex,
	): void {
		const atlas = r.atlas;
		if (this.cacheGen !== atlas.generation) {
			this.resetCaches(atlas.generation);
		}
		const x = this.wx[pointIndex] as number;
		const y = this.wy[pointIndex] as number;

		let e = this.iconCache[pointIndex];
		if (e === undefined) {
			const icon = this.markerIcon(this.points[pointIndex] as T);
			e = getIcon(atlas, icon, iconKey(icon));
			// not cached while loading: retried on the next rebuild (triggered by the image load)
			if (e) {
				this.iconCache[pointIndex] = e;
			}
		}
		if (!e) {
			return;
		}

		pushSprite(sprites, x, y, e, dx, dy, WHITE, 0, anim);
		this.hits.add(
			x,
			y,
			dx - e.anchorX,
			dy - e.anchorY,
			dx + e.width - e.anchorX,
			dy + e.height - e.anchorY,
			kind,
			ref,
		);

		let t = this.labelCache[pointIndex];
		if (t === undefined) {
			const label = (this.opts.marker?.label ?? defaultLabel)(this.points[pointIndex] as T);
			t =
				label === null || label === undefined || label === ""
					? null
					: getText(atlas, String(label), this.markerFont());
			this.labelCache[pointIndex] = t;
		}
		if (t) {
			pushSprite(
				sprites,
				x,
				y,
				t,
				dx + e.labelX - e.anchorX,
				dy + e.labelY - e.anchorY,
				WHITE,
				0,
				anim,
			);
		}

		// number of points at the same position
		if (weight > 1) {
			const bx = dx + e.width - e.anchorX - 3;
			const by = dy - e.anchorY + 3;
			const text = abbreviateCount(weight);
			const radius = Math.max(8, 3 + text.length * 3);
			// drawn after the markers, text rasterized over the badge color
			pushCircle(
				badges,
				x,
				y,
				{
					radius,
					strokeWidth: 1.5,
					fill: parseColor(BADGE_COLOR),
					stroke: WHITE,
					stops: null,
					colors: null,
				},
				bx,
				by,
				anim,
				getText(atlas, text, DEFAULT_BADGE_FONT, BADGE_COLOR),
			);
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Spiderfy
	// ---------------------------------------------------------------------------------------------

	private openSpider(
		x: number,
		y: number,
		members: number[],
		leaf: number,
		cluster: number,
	): void {
		this.spider = {
			x,
			y,
			members,
			offsets: spiderOffsets(members.length),
			leaf,
			cluster,
		};
		this.dirty = true;
		this.overlay.requestRender();
	}

	private closeSpider(): void {
		if (this.spider) {
			this.spider = null;
			this.dirty = true;
			this.overlay.requestRender();
		}
	}

	private rebuildSpider(r: Renderer, view: KnView): void {
		this.spiderLines.clear();
		this.spiderCircles.clear();
		this.spiderSprites.clear();
		const s = this.spider;
		if (!s) {
			return;
		}

		const color = parseColor("rgba(60,64,67,0.8)");
		for (let i = 0; i < s.members.length; i++) {
			const dx = s.offsets[2 * i] as number;
			const dy = s.offsets[2 * i + 1] as number;
			pushLine(
				this.spiderLines,
				s.x,
				s.y,
				s.x + dx / view.scale,
				s.y + dy / view.scale,
				color,
				1.5,
			);
		}
		// markers are positioned relatively to the spider center
		for (let i = 0; i < s.members.length; i++) {
			const dx = s.offsets[2 * i] as number;
			const dy = s.offsets[2 * i + 1] as number;
			const p = this.points[s.members[i] as number] as T;
			const ox = (s.x - lngX(p.x)) * view.scale;
			const oy = (s.y - latY(p.y)) * view.scale;
			this.pushPoint(
				r,
				s.members[i] as number,
				KIND_SPIDER,
				1,
				null,
				dx + ox,
				dy + oy,
				this.spiderSprites,
				this.spiderCircles,
				i,
			);
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Events
	// ---------------------------------------------------------------------------------------------

	private event(hit: number, e: KnPointer | null): KnHoverEvent<T, A> | null {
		const kind = this.hits.kind(hit);
		const ref = this.hits.ref(hit);
		const base = {
			latLng: e?.latLng ?? null,
			domEvent: e?.domEvent ?? null,
		};

		if (kind === KIND_CLUSTER) {
			if (!this.level) {
				return null;
			}
			return {
				type: "cluster",
				cluster: this.makeCluster(this.level, ref),
				...base,
			};
		}

		const index = kind === KIND_SPIDER ? (this.spider?.members[ref] ?? -1) : ref;
		const point = this.points[index];
		if (point === undefined) {
			return null;
		}

		let duplicates: T[] = [];
		if (kind === KIND_POINT && this.index?.dupNext) {
			// the leaf rows of this point
			const row = this.pointToRow[index] ?? -1;
			duplicates = this.index
				.duplicatesOf(row)
				.slice(1)
				.map((d) => this.points[this.rowToPoint[d] as number] as T);
		}
		return {
			type: "point",
			point,
			index,
			duplicates,
			...base,
		};
	}

	private onClick(hit: number, e: KnPointer): void {
		const kind = this.hits.kind(hit);
		const ref = this.hits.ref(hit);

		if (kind === KIND_CLUSTER && this.level && this.index) {
			const handler = this.opts.onClusterClick ?? "zoom";
			const level = this.level;
			if (handler === false) {
				return;
			}
			if (handler !== "zoom") {
				const ev = this.event(hit, e);
				if (ev?.type === "cluster") {
					handler(ev);
				}
				return;
			}

			const id = level.data[ref + OFFSET_ID] as number;
			const x = decode(level.data[ref] as number);
			const y = decode(level.data[ref + 1] as number);
			const expansion = this.index.getClusterExpansionZoom(id);
			const maxZoom = (this.map.get("maxZoom") as number | null | undefined) ?? 22;
			const zoom = this.map.getZoom() ?? 0;

			if (expansion > maxZoom || zoom >= maxZoom) {
				// cannot zoom more: spiderfy the points of the cluster
				const members = this.index
					.getLeaves(id, 100)
					.map((row) => this.rowToPoint[row] as number);
				this.openSpider(x, y, members, -1, id);
			} else {
				this.map.setOptions({
					center: {
						lat: yLat(y),
						lng: xLng(x),
					},
					zoom: expansion,
				});
			}
			return;
		}

		if (kind === KIND_POINT && this.index) {
			const row = this.pointToRow[ref] ?? -1;
			const group = this.index.duplicatesOf(row);
			const mode = this.opts.duplicates ?? "spiderfy";
			if (group.length > 1 && mode === "info" && this.opts.infoWindow) {
				this.openDuplicatesInfo(
					hit,
					e,
					group.map((d) => this.rowToPoint[d] as number),
				);
				return;
			}
			if (group.length > 1 && (mode === "spiderfy" || mode === "info")) {
				const p = this.points[ref] as T;
				if (this.spider?.leaf === row) {
					this.closeSpider();
				} else {
					this.openSpider(
						lngX(p.x),
						latY(p.y),
						group.map((d) => this.rowToPoint[d] as number),
						row,
						-1,
					);
				}
				return;
			}
		}

		const ev = this.event(hit, e);
		if (ev?.type === "point") {
			this.opts.onMarkerClick?.(ev);
			const content = this.opts.infoWindow?.(ev);
			if (content) {
				// tip of the info window on the top of the icon
				this.openInfoWindow(content, this.hitPosition(hit), this.hits.top(hit));
			}
		}
	}

	/** Position (lng / lat) of a clicked item */
	private hitPosition(hit: number): KnPoint {
		return {
			x: xLng(this.hits.x(hit)),
			y: yLat(this.hits.y(hit)),
		};
	}

	/**
	 * Info window of points at the same position, with a navigation between them
	 */
	private openDuplicatesInfo(hit: number, e: KnPointer, members: number[]): void {
		const eventOf = (i: number): KnMarkerEvent<T> => {
			const index = members[i] as number;
			return {
				type: "point",
				point: this.points[index] as T,
				index,
				duplicates: members.filter((_, j) => j !== i).map((m) => this.points[m] as T),
				latLng: e.latLng,
				domEvent: e.domEvent,
			};
		};

		const first = eventOf(0);
		this.opts.onMarkerClick?.(first);
		const content = this.opts.infoWindow?.(first);
		if (!content) {
			return;
		}
		this.openInfoWindow(content, this.hitPosition(hit), this.hits.top(hit), {
			index: 0,
			count: members.length,
			onChange: (i) => {
				const c = this.opts.infoWindow?.(eventOf(i));
				if (c) {
					this.info.setContent(c);
				}
			},
		});
	}

	/**
	 * Open the info window (one per map: the opened one is closed)
	 * @param position x = longitude, y = latitude
	 * @param offset pixel offset of the tip (ex: [0, -40] above a 40 px high pin)
	 * @param nav navigation between several items
	 */
	openInfoWindow(
		content: string | Node,
		position: KnPoint,
		offset?: readonly [
			number,
			number,
		],
		nav?: KnInfoNav,
	): void {
		this.infoOpen = true;
		this.info.open(content, position, {
			...this.opts.infoWindowOptions,
			...(offset
				? {
						offset,
					}
				: {}),
			...(nav
				? {
						nav,
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

	private onHover(hit: number, e: KnPointer | null): void {
		const cb = this.opts.onHover;
		if (cb) {
			cb(hit >= 0 ? this.event(hit, e) : null);
		}
	}
}
