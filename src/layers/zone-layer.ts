/**
 * KnZoneLayer: instead of clusters, the outer perimeter of groups of points.
 *
 * Each point has a group (and optionally a group label). Each group is drawn as its exact outer
 * perimeter: the concave hull passing through its outermost points (transparent fill, opaque
 * border), with its label and number of points in the middle. A click on a
 * zone opens it: its markers are displayed, a close button appears. A click outside (or on another
 * zone) closes it.
 */

import type { KnAggregates } from "../core/aggregate.ts";
import { latY, lngX, xLng, yLat } from "../core/mercator.ts";
import { DEFAULT_ZONE_OPTIONS, insideZone, unpackZones, type ZoneShape } from "../core/zones.ts";
import { whenMapReadyForViewport } from "../maps/ready.ts";
import { parseColor, WHITE } from "../render/color.ts";
import type { AtlasEntry } from "../render/gl/atlas.ts";
import { InstanceBuffer } from "../render/gl/instances.ts";
import { CIRCLE, LINE, POLY, SPRITE } from "../render/gl/layouts.ts";
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
	KnInfoWindow,
	type KnInfoWindowOptions,
} from "../render/info-window.ts";
import { KnOverlay, type KnPointer, type OverlayLayer } from "../render/overlay.ts";
import type { KnView } from "../render/view.ts";
import { pushCircle, pushLine, pushSprite, pushVertex } from "../render/write.ts";
import type { KnEventBase, KnMarkerEvent, KnPoint } from "../types.ts";
import { runInWorker } from "../worker/client.ts";
import { type KnClustererOptions, KnGmapClusterer } from "./cluster-layer.ts";

/** A zone (group of points) */
export interface KnZone<T> {
	/** group key */
	readonly key: string | number;
	readonly label: string | null;
	readonly count: number;
	/** position of the label (x = longitude, y = latitude) */
	readonly x: number;
	readonly y: number;
	readonly color: string;
	readonly points: readonly T[];
}

export interface KnZoneEvent<T> extends KnEventBase {
	readonly type: "zone";
	readonly zone: KnZone<T>;
}

export interface KnZoneMarkerOptions<T> {
	/** icon of the markers (default: a pin of the zone color) */
	readonly icon?: KnIcon | ((point: T) => KnIcon);
	/** label of the markers */
	readonly label?: (point: T) => string | number | null | undefined;
	readonly font?: KnFont;
}

export interface KnZoneLabelOptions {
	/** text font (default white bold 12 px) */
	readonly font?: KnFont;
	/** background color (default: zone color) */
	readonly background?: string;
	/** show the number of points (default true) */
	readonly count?: boolean;
}

export interface KnZoneOptions<T extends KnPoint> {
	/** group of a point (default: its `group` property), points without group are always shown */
	readonly group?: (point: T) => string | number | null | undefined;
	/** label of the group of a point (default: its `groupLabel` property) */
	readonly groupLabel?: (point: T) => string | null | undefined;
	/** zone color (border, label, markers) */
	readonly color?: string | ((zone: Omit<KnZone<T>, "color">) => string);
	/** opacity of the zone fill (default 0.15) */
	readonly fillOpacity?: number;
	/** opacity of the fill of the opened zone (default 0.28) */
	readonly openFillOpacity?: number;
	/** border width in CSS px (default 2.5) */
	readonly strokeWidth?: number;
	/** labels in the middle of the zones, false to hide them */
	readonly labels?: KnZoneLabelOptions | false;
	/** close button on the opened zone (default true) */
	readonly closeButton?: boolean;
	/** markers of the opened zone */
	readonly marker?: KnZoneMarkerOptions<T>;
	/**
	 * cluster the markers of the opened zone: true or clusterer options (default false: every
	 * marker is drawn)
	 */
	readonly cluster?: boolean | KnClustererOptions<T, KnAggregates<T>>;
	/**
	 * how closely the outline follows the points: 1 = very concave, Infinity = convex hull
	 * (default 2)
	 */
	readonly concavity?: number;
	/** fit the map to the points on load (default true) */
	readonly fit?: boolean;
	/** compute the zones in a Web Worker: 'auto' (default) above 20k points */
	readonly worker?: "auto" | boolean;
	/** drawing order (default -5: below the clusterers, above the routes) */
	readonly zIndex?: number;
	/** a zone was clicked (it is opened unless the callback returns false) */
	readonly onZoneClick?: (e: KnZoneEvent<T>) => boolean | undefined;
	/** the opened zone changed (null: closed) */
	readonly onZoneOpen?: (zone: KnZone<T> | null) => void;
	readonly onMarkerClick?: (e: KnMarkerEvent<T>) => void;
	/** content of the info window of the markers */
	readonly infoWindow?: (e: KnMarkerEvent<T>) => KnInfoContent;
	readonly infoWindowOptions?: KnInfoWindowOptions;
}

const PALETTE = [
	"#1a73e8",
	"#d93025",
	"#1e8e3e",
	"#f29900",
	"#9334e6",
	"#12b5cb",
	"#e8710a",
	"#b31412",
	"#188038",
	"#5f6368",
];

const LABEL_FONT: ResolvedFont = {
	color: "#fff",
	size: 12,
	family: "Roboto, Arial, sans-serif",
	weight: "bold",
	halo: null,
	haloWidth: 0,
};

const MARKER_FONT: ResolvedFont = {
	color: "#000",
	size: 12,
	family: "Roboto, Arial, sans-serif",
	weight: "bold",
	halo: "#fff",
	haloWidth: 2,
};

const KIND_MARKER = 0;
const KIND_LABEL = 1;
const KIND_CLOSE = 2;
const WORKER_THRESHOLD = 20_000;
const CLOSE_RADIUS = 11;

interface ZoneData<T> {
	readonly zone: KnZone<T>;
	readonly shape: ZoneShape;
	readonly members: number[];
	readonly fill: number;
	readonly stroke: number;
	/** world bbox of the outline */
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
}

/** Packed color to [r, g, b, a] in [0, 1] */
function rgba(c: number): [
	number,
	number,
	number,
	number,
] {
	return [
		(c & 255) / 255,
		((c >>> 8) & 255) / 255,
		((c >>> 16) & 255) / 255,
		(c >>> 24) / 255,
	];
}

function withAlpha(color: number, alpha: number): number {
	return ((color & 0x00ffffff) | (Math.round(Math.max(0, Math.min(1, alpha)) * 255) << 24)) >>> 0;
}

/**
 * Zones of groups of points, drawn with WebGL2.
 *
 * @example
 * const zones = new KnZoneLayer(map);
 * zones.load(points); // [{ x: lng, y: lat, group: "A", groupLabel: "Depot north" }]
 */
export class KnZoneLayer<T extends KnPoint = KnPoint> {
	readonly map: google.maps.Map;
	private opts: KnZoneOptions<T>;
	private readonly overlay: KnOverlay;
	private readonly layer: OverlayLayer;
	private readonly info: KnInfoWindow;
	private infoOpen = false;
	private loadToken = 0;

	private points: readonly T[] = [];
	private wx: Float64Array = new Float64Array(0);
	private wy: Float64Array = new Float64Array(0);
	private zones: ZoneData<T>[] = [];
	/** points without group */
	private loose: number[] = [];
	private openIndex = -1;
	/** clusterer of the opened zone (cluster option) */
	private child: KnGmapClusterer<T> | null = null;

	// render state
	/** vertices of the outlines (filled with the stencil buffer) */
	private readonly polyBuf = new InstanceBuffer(POLY);
	private polys: {
		first: number;
		count: number;
		color: [
			number,
			number,
			number,
			number,
		];
	}[] = [];
	/** borders */
	private readonly lines = new InstanceBuffer(LINE);
	private readonly sprites = new InstanceBuffer(SPRITE);
	private readonly hits = new HitList();
	/** labels and close button: drawn by a second layer, above the clusters of the opened zone */
	private readonly labelSprites = new InstanceBuffer(SPRITE);
	private readonly circles = new InstanceBuffer(CIRCLE);
	private readonly labelHits = new HitList();
	private readonly labelLayer: OverlayLayer;
	private dirty = true;
	private atlasGen = -1;
	private zoom = Number.NaN;
	private renderer: Renderer | null = null;

	constructor(map: google.maps.Map, options: KnZoneOptions<T> = {}) {
		this.map = map;
		this.opts = options;
		this.overlay = KnOverlay.for(map);
		this.info = KnInfoWindow.for(map);
		const self = this;
		this.layer = {
			get zIndex(): number {
				return self.opts.zIndex ?? -5;
			},
			render: (r, view) => this.render(r, view),
			hitTest: (view, x, y) => this.hitTest(view, x, y),
			click: (hit, e) => this.onClick(hit, e),
			hover: () => undefined,
			invalidate: () => {
				this.dirty = true;
			},
			// a click in the opened zone (ex: on one of its clusters) keeps it opened
			clickEmpty: (e) => {
				const open = this.zones[this.openIndex];
				if (!open || !this.contains(open, e.x, e.y)) {
					this.close();
				}
			},
			destroy: () => this.destroy(),
		};
		this.labelLayer = {
			get zIndex(): number {
				return (self.opts.zIndex ?? -5) + 0.75;
			},
			render: (r) => {
				r.drawSprites(this.labelSprites);
				r.drawCircles(this.circles);
				return false;
			},
			hitTest: (view, x, y) => this.labelHits.find(view, x, y),
			click: (hit, e) => {
				if (this.labelHits.kind(hit) === KIND_CLOSE) {
					this.close();
				} else {
					this.clickZone(this.labelHits.ref(hit), e);
				}
			},
			hover: () => undefined,
			invalidate: () => {
				this.dirty = true;
			},
			destroy: () => this.destroy(),
		};
		this.overlay.add(this.layer);
		this.overlay.add(this.labelLayer);
	}

	/** Current options */
	get options(): KnZoneOptions<T> {
		return this.opts;
	}

	/**
	 * Load the points (replaces the previous ones)
	 * @returns resolved once the zones are drawn
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

		// groups
		const groupOf =
			this.opts.group ??
			((p: T) =>
				(
					p as {
						group?: string | number;
					}
				).group);
		const labelOf =
			this.opts.groupLabel ??
			((p: T) =>
				(
					p as {
						groupLabel?: string | null;
					}
				).groupLabel);
		const keys = new Map<string | number, number>();
		const labels: (string | null)[] = [];
		const members: number[][] = [];
		const groups = new Int32Array(n).fill(-1);
		const loose: number[] = [];
		for (let i = 0; i < n; i++) {
			const p = points[i] as T;
			const key = groupOf(p);
			if (key === null || key === undefined) {
				loose.push(i);
				continue;
			}
			let g = keys.get(key);
			if (g === undefined) {
				g = keys.size;
				keys.set(key, g);
				labels.push(null);
				members.push([]);
			}
			groups[i] = g;
			(members[g] as number[]).push(i);
			if (labels[g] === null) {
				labels[g] = labelOf(p) ?? null;
			}
		}

		if (options.fit ?? this.opts.fit ?? true) {
			this.fitBounds(points);
		}

		const count = keys.size;
		const hullOptions = {
			concavity: this.opts.concavity ?? DEFAULT_ZONE_OPTIONS.concavity,
		};
		const worker = this.opts.worker ?? "auto";
		const result = await runInWorker(
			() => ({
				type: "zones",
				xs: wx.slice(),
				ys: wy.slice(),
				groups: groups.slice(),
				count,
				options: hullOptions,
			}),
			worker === "auto" ? n > WORKER_THRESHOLD : worker,
		);
		if (token !== this.loadToken || result.type !== "zones") {
			return;
		}

		const shapes = unpackZones(result.zones);
		const color = this.opts.color;
		const entries = [
			...keys.entries(),
		];
		this.zones = entries.map(([key, g]) => {
			const shape = shapes[g] as ZoneShape;
			const m = members[g] as number[];
			const base = {
				key,
				label: labels[g] ?? null,
				count: m.length,
				x: xLng(shape.labelX),
				y: yLat(shape.labelY),
				points: m.map((i) => points[i] as T),
			};
			let minX = Number.POSITIVE_INFINITY;
			let minY = Number.POSITIVE_INFINITY;
			let maxX = Number.NEGATIVE_INFINITY;
			let maxY = Number.NEGATIVE_INFINITY;
			for (const i of shape.ring) {
				minX = Math.min(minX, wx[i] as number);
				maxX = Math.max(maxX, wx[i] as number);
				minY = Math.min(minY, wy[i] as number);
				maxY = Math.max(maxY, wy[i] as number);
			}
			const css =
				typeof color === "function"
					? color(base)
					: (color ?? (PALETTE[g % PALETTE.length] as string));
			const stroke = parseColor(css);
			return {
				zone: {
					...base,
					color: css,
				},
				shape,
				members: m,
				fill: withAlpha(stroke, this.opts.fillOpacity ?? 0.15),
				stroke,
				minX,
				minY,
				maxX,
				maxY,
			};
		});
		this.points = points;
		this.wx = wx;
		this.wy = wy;
		this.loose = loose;
		this.openIndex = -1;
		this.child?.destroy();
		this.child = null;
		this.dirty = true;
		this.overlay.requestRender();
	}

	/** Update some options (the zones are recomputed when needed) */
	setOptions(options: Partial<KnZoneOptions<T>>): Promise<void> {
		const prev = this.opts;
		this.opts = {
			...prev,
			...options,
		};
		if ("zIndex" in options) {
			this.overlay.sort();
		}
		const recompute = (
			[
				"group",
				"groupLabel",
				"color",
				"fillOpacity",
				"concavity",
			] as const
		).some((k) => k in options && options[k] !== prev[k]);
		if (recompute) {
			return this.load(this.points, {
				fit: false,
			});
		}
		// reopen the opened zone to apply its markers options
		const opened = this.getOpenZone();
		if (opened && ("cluster" in options || "marker" in options)) {
			this.open(null);
			this.open(opened.key);
		}
		this.dirty = true;
		this.overlay.requestRender();
		return Promise.resolve();
	}

	/** Zones */
	getZones(): KnZone<T>[] {
		return this.zones.map((z) => z.zone);
	}

	/** Opened zone */
	getOpenZone(): KnZone<T> | null {
		return this.zones[this.openIndex]?.zone ?? null;
	}

	/** Open a zone (show its markers), null to close */
	open(key: string | number | null): void {
		const i = key === null ? -1 : this.zones.findIndex((z) => z.zone.key === key);
		if (i === this.openIndex) {
			return;
		}
		if (this.infoOpen) {
			this.info.close();
		}
		this.child?.destroy();
		this.child = null;
		this.openIndex = i;

		// clustering of the points of the opened zone
		const zone = this.zones[i];
		const cluster = this.opts.cluster;
		if (zone && cluster) {
			const o = cluster === true ? {} : cluster;
			const m = this.opts.marker;
			const color = zone.zone.color;
			this.child = new KnGmapClusterer<T>(this.map, {
				...o,
				fit: false,
				zIndex: o.zIndex ?? (this.opts.zIndex ?? -5) + 0.5,
				marker: {
					icon:
						m?.icon ??
						(() => ({
							pin: color,
						})),
					...(m?.label
						? {
								label: m.label,
							}
						: {}),
					...(m?.font
						? {
								font: m.font,
							}
						: {}),
					...o.marker,
				},
				cluster:
					o.cluster === false
						? false
						: {
								color,
								...o.cluster,
							},
				...(this.opts.infoWindow
					? {
							infoWindow: this.opts.infoWindow,
						}
					: {}),
				...(this.opts.infoWindowOptions
					? {
							infoWindowOptions: this.opts.infoWindowOptions,
						}
					: {}),
				...(this.opts.onMarkerClick
					? {
							onMarkerClick: this.opts.onMarkerClick,
						}
					: {}),
			});
			void this.child.load(zone.zone.points, {
				fit: false,
			});
		}

		this.dirty = true;
		this.overlay.requestRender();
		this.opts.onZoneOpen?.(this.getOpenZone());
	}

	/** Is a world position inside a zone? */
	private contains(z: ZoneData<T>, x: number, y: number): boolean {
		const zx = x - Math.round(x - (z.minX + z.maxX) / 2);
		return (
			zx >= z.minX &&
			zx <= z.maxX &&
			y >= z.minY &&
			y <= z.maxY &&
			insideZone(this.wx, this.wy, z.shape, zx, y)
		);
	}

	/** Close the opened zone */
	close(): void {
		this.open(null);
	}

	/** Remove the zones */
	clear(): void {
		this.loadToken++;
		this.points = [];
		this.zones = [];
		this.loose = [];
		this.openIndex = -1;
		this.child?.destroy();
		this.child = null;
		this.dirty = true;
		this.overlay.requestRender();
	}

	/** Remove the layer from the map */
	destroy(): void {
		this.clear();
		if (this.infoOpen) {
			this.info.close();
		}
		this.overlay.remove(this.layer);
		this.overlay.remove(this.labelLayer);
		if (this.renderer) {
			for (const b of [
				this.polyBuf,
				this.lines,
				this.sprites,
				this.labelSprites,
				this.circles,
			]) {
				this.renderer.release(b);
			}
		}
	}

	/** Fit the map to the points */
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

	// ---------------------------------------------------------------------------------------------
	// Render
	// ---------------------------------------------------------------------------------------------

	private render(r: Renderer, view: KnView): boolean {
		this.renderer = r;
		if (this.dirty || r.atlas.generation !== this.atlasGen || view.zoom !== this.zoom) {
			const gen = r.atlas.generation;
			this.rebuild(r, view);
			if (r.atlas.generation !== gen) {
				this.rebuild(r, view);
			}
		}

		r.drawPolygons(this.polyBuf, this.polys);
		r.drawLines(this.lines);
		r.drawSprites(this.sprites);
		return false;
	}

	private rebuild(r: Renderer, view: KnView): void {
		const atlas = r.atlas;
		this.dirty = false;
		this.atlasGen = atlas.generation;
		this.zoom = view.zoom;
		this.polyBuf.clear();
		this.polys = [];
		this.lines.clear();
		this.sprites.clear();
		this.labelSprites.clear();
		this.circles.clear();
		this.hits.clear();
		this.labelHits.clear();

		const strokeWidth = this.opts.strokeWidth ?? 2.5;
		const openFill = this.opts.openFillOpacity ?? 0.28;

		this.zones.forEach((z, i) => {
			const ring = z.shape.ring;
			const open = i === this.openIndex;
			// fill: exact polygon of the outline
			if (ring.length >= 3) {
				const first = this.polyBuf.count;
				for (const p of ring) {
					pushVertex(this.polyBuf, this.wx[p] as number, this.wy[p] as number);
				}
				this.polys.push({
					first,
					count: ring.length,
					color: rgba(open ? withAlpha(z.stroke, openFill) : z.fill),
				});
			}
			// border: through the outermost points
			const width = open ? strokeWidth + 1 : strokeWidth;
			const n = ring.length;
			for (let k = 0; k < (n > 2 ? n : n - 1); k++) {
				const a = ring[k] as number;
				const b = ring[(k + 1) % n] as number;
				pushLine(
					this.lines,
					this.wx[a] as number,
					this.wy[a] as number,
					this.wx[b] as number,
					this.wy[b] as number,
					z.stroke,
					width,
				);
			}
		});

		// markers of the opened zone, and the points without zone
		const open = this.zones[this.openIndex];
		if (open && !this.child) {
			for (const i of open.members) {
				this.pushMarker(r, i, open.zone.color);
			}
		}
		for (const i of this.loose) {
			this.pushMarker(r, i, "#5f6368");
		}

		// labels (above the markers)
		const labels = this.opts.labels ?? {};
		if (labels !== false) {
			this.zones.forEach((z, i) => {
				this.pushLabel(r, z, i, labels);
			});
		}
	}

	private pushMarker(r: Renderer, i: number, color: string): void {
		const p = this.points[i] as T;
		const m = this.opts.marker;
		const icon: KnIcon = (typeof m?.icon === "function" ? m.icon(p) : m?.icon) ?? {
			pin: color,
		};
		const e: AtlasEntry | null = getIcon(r.atlas, icon, iconKey(icon));
		if (!e) {
			return;
		}
		const x = this.wx[i] as number;
		const y = this.wy[i] as number;
		pushSprite(this.sprites, x, y, e);
		this.hits.add(
			x,
			y,
			-e.anchorX,
			-e.anchorY,
			e.width - e.anchorX,
			e.height - e.anchorY,
			KIND_MARKER,
			i,
		);
		const label = m?.label?.(p);
		if (label !== null && label !== undefined && label !== "") {
			const t = getText(r.atlas, String(label), resolveFont(m?.font, MARKER_FONT));
			pushSprite(this.sprites, x, y, t, e.labelX - e.anchorX, e.labelY - e.anchorY);
		}
	}

	private pushLabel(r: Renderer, z: ZoneData<T>, i: number, o: KnZoneLabelOptions): void {
		const zone = z.zone;
		const parts: string[] = [];
		if (zone.label) {
			parts.push(zone.label);
		}
		if (o.count !== false) {
			parts.push(String(zone.count));
		}
		if (parts.length === 0) {
			return;
		}

		const font = resolveFont(o.font, LABEL_FONT);
		const bg = o.background ?? zone.color;
		// opaque background: sharp (sub-pixel) text, rounded by the sprite shader
		const height = Math.round(font.size * 1.9);
		const e = getText(r.atlas, parts.join(" · "), font, bg, {
			padX: Math.round(height * 0.45),
			height,
		});
		const x = z.shape.labelX;
		const y = z.shape.labelY;
		pushSprite(this.labelSprites, x, y, e, 0, 0, WHITE, 0, null, e.height / 2);
		const hw = e.width / 2;
		const hh = e.height / 2;
		this.labelHits.add(x, y, -hw, -hh, hw, hh, KIND_LABEL, i);

		// close button of the opened zone
		if (i === this.openIndex && this.opts.closeButton !== false) {
			const cx = hw + CLOSE_RADIUS + 4;
			const cross = getText(
				r.atlas,
				"×",
				{
					...font,
					color: "#3c4043",
					size: 16,
				},
				"#fff",
			);
			pushCircle(
				this.circles,
				x,
				y,
				{
					radius: CLOSE_RADIUS,
					strokeWidth: 1.5,
					fill: WHITE,
					stroke: parseColor(zone.color),
					stops: null,
					colors: null,
				},
				cx,
				0,
				null,
				cross,
			);
			this.labelHits.add(
				x,
				y,
				cx - CLOSE_RADIUS,
				-CLOSE_RADIUS,
				cx + CLOSE_RADIUS,
				CLOSE_RADIUS,
				KIND_CLOSE,
				i,
			);
		}
	}

	// ---------------------------------------------------------------------------------------------
	// Events
	// ---------------------------------------------------------------------------------------------

	/** Hit: index in the hit list, or hits.count + zone index for a click in a zone */
	private hitTest(view: KnView, x: number, y: number): number {
		const hit = this.hits.find(view, x, y);
		if (hit >= 0) {
			return hit;
		}
		// zones: the opened one first, then the last drawn
		const order = this.zones.map((_, i) => i).reverse();
		if (this.openIndex >= 0) {
			order.unshift(this.openIndex);
		}
		for (const i of order) {
			const z = this.zones[i] as ZoneData<T>;
			// world copies: bring x near the zone
			const zx = x - Math.round(x - (z.minX + z.maxX) / 2);
			if (
				zx >= z.minX &&
				zx <= z.maxX &&
				y >= z.minY &&
				y <= z.maxY &&
				insideZone(this.wx, this.wy, z.shape, zx, y)
			) {
				return this.hits.count + i;
			}
		}
		return -1;
	}

	private onClick(hit: number, e: KnPointer): void {
		if (hit >= this.hits.count) {
			this.clickZone(hit - this.hits.count, e);
			return;
		}
		const kind = this.hits.kind(hit);
		const ref = this.hits.ref(hit);
		if (kind === KIND_CLOSE) {
			this.close();
		} else if (kind === KIND_LABEL) {
			this.clickZone(ref, e);
		} else if (kind === KIND_MARKER) {
			const point = this.points[ref] as T;
			const ev: KnMarkerEvent<T> = {
				type: "point",
				point,
				index: ref,
				duplicates: [],
				latLng: e.latLng,
				domEvent: e.domEvent,
			};
			this.opts.onMarkerClick?.(ev);
			const content = this.opts.infoWindow?.(ev);
			if (content) {
				this.infoOpen = true;
				this.info.open(
					content,
					{
						x: point.x,
						y: point.y,
					},
					{
						...this.opts.infoWindowOptions,
						offset: this.hits.top(hit),
						onClose: () => {
							this.infoOpen = false;
						},
					},
				);
			}
		}
	}

	private clickZone(i: number, e: KnPointer): void {
		const z = this.zones[i];
		if (!z) {
			return;
		}
		const handled = this.opts.onZoneClick?.({
			type: "zone",
			zone: z.zone,
			latLng: e.latLng,
			domEvent: e.domEvent,
		});
		if (handled !== false) {
			this.open(z.zone.key);
		}
	}
}
