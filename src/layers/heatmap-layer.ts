/**
 * KnHeatmapLayer: weighted heatmap drawn with WebGL2.
 *
 * Each point contributes with its value (weight). The points are aggregated in cells of a quarter
 * of the radius for each zoom (bounded number of splats, smooth result), the splats are summed in a
 * float texture, then colored with a gradient.
 */

import {
	aggregateHeat,
	HEAT_K,
	type HeatAggregate,
	type HeatCells,
	maxHeat,
} from "../core/heatmap.ts";
import { latY, lngX, yLat } from "../core/mercator.ts";
import { whenMapReadyForViewport } from "../maps/ready.ts";
import { InstanceBuffer } from "../render/gl/instances.ts";
import { HEAT } from "../render/gl/layouts.ts";
import type { Renderer } from "../render/gl/renderer.ts";
import { KnOverlay, type OverlayLayer } from "../render/overlay.ts";
import type { KnView } from "../render/view.ts";
import { pushSplat } from "../render/write.ts";
import type { KnPoint } from "../types.ts";

export interface KnHeatmapOptions<T extends KnPoint> {
	/** weight of a point (default: its `value` property, else 1), <= 0 ignored */
	readonly weight?: (point: T) => number;
	/** radius of the influence of a point (default 25) */
	readonly radius?: number;
	/** unit of the radius: CSS px (constant on screen, default) or meters (constant on the ground) */
	readonly radiusUnit?: "px" | "m";
	/** min radius in CSS px with a radius in meters: keeps the far zooms visible (default 1) */
	readonly minRadius?: number;
	/**
	 * How the nearby points are combined: `sum` (default) = density, the more points the hotter;
	 * `max` = each place shows the strongest nearby value, whatever the number of points
	 * (measurements: noise, pollution...)
	 */
	readonly aggregate?: HeatAggregate;
	/** multiplier of the density (default 1) */
	readonly intensity?: number;
	/**
	 * density of the last color of the gradient: 'auto' (default) = max density of the data at
	 * the current zoom, or a fixed value (sum of the weights at a point)
	 */
	readonly max?: number | "auto";
	/** colors from the lowest to the highest density */
	readonly gradient?: readonly string[];
	/** opacity of the heatmap (default 0.75) */
	readonly opacity?: number;
	/** fit the map to the points on load (default true) */
	readonly fit?: boolean;
	/** drawing order (default -8: below the zones and markers) */
	readonly zIndex?: number;
}

/** Default gradient: transparent blue, cyan, green, yellow, orange, red */
export const KN_HEAT_GRADIENT: readonly string[] = [
	"rgba(0, 80, 255, 0)",
	"rgba(0, 170, 255, 0.55)",
	"rgba(0, 220, 120, 0.75)",
	"rgba(230, 230, 0, 0.85)",
	"rgba(255, 140, 0, 0.92)",
	"rgba(220, 20, 30, 1)",
];

const EARTH = 40_075_016.686;

interface ZoomData {
	readonly cells: HeatCells;
	readonly max: number;
}

/**
 * Weighted heatmap
 *
 * @example
 * const heat = new KnHeatmapLayer(map, { radius: 30 });
 * heat.load(points); // [{ x: lng, y: lat, value: 12 }]
 */
export class KnHeatmapLayer<T extends KnPoint = KnPoint> {
	readonly map: google.maps.Map;
	private opts: KnHeatmapOptions<T>;
	private readonly overlay: KnOverlay;
	private readonly layer: OverlayLayer;

	private points: readonly T[] = [];
	private wx: Float64Array = new Float64Array(0);
	private wy: Float64Array = new Float64Array(0);
	private ws: Float64Array = new Float64Array(0);
	private latitude = 0;
	/** aggregation of each zoom */
	private readonly zooms = new Map<number, ZoomData>();

	private readonly splats = new InstanceBuffer(HEAT);
	private zoom = Number.NaN;
	private dirty = true;
	private gradient: WebGLTexture | null = null;
	private gradientGen = -1;
	private renderer: Renderer | null = null;

	constructor(map: google.maps.Map, options: KnHeatmapOptions<T> = {}) {
		this.map = map;
		this.opts = options;
		this.overlay = KnOverlay.for(map);
		const self = this;
		this.layer = {
			get zIndex(): number {
				return self.opts.zIndex ?? -8;
			},
			render: (r, view) => this.render(r, view),
			hitTest: () => -1,
			click: () => undefined,
			hover: () => undefined,
			invalidate: () => {
				this.dirty = true;
			},
			destroy: () => this.destroy(),
		};
		this.overlay.add(this.layer);
	}

	/** Current options */
	get options(): KnHeatmapOptions<T> {
		return this.opts;
	}

	/** Load the points (replaces the previous ones) */
	load(
		points: readonly T[],
		options: {
			readonly fit?: boolean;
		} = {},
	): void {
		this.points = points;
		const n = points.length;
		this.wx = new Float64Array(n);
		this.wy = new Float64Array(n);
		let sumY = 0;
		for (let i = 0; i < n; i++) {
			const p = points[i] as T;
			this.wx[i] = lngX(p.x);
			this.wy[i] = latY(p.y);
			sumY += this.wy[i] as number;
		}
		this.latitude = n > 0 ? yLat(sumY / n) : 0;
		this.computeWeights();
		if (options.fit ?? this.opts.fit ?? true) {
			this.fitBounds();
		}
	}

	/** Update some options */
	setOptions(options: Partial<KnHeatmapOptions<T>>): void {
		this.opts = {
			...this.opts,
			...options,
		};
		if ("zIndex" in options) {
			this.overlay.sort();
		}
		if ("gradient" in options && this.gradient) {
			this.renderer?.deleteTexture(this.gradient);
			this.gradient = null;
		}
		if ("weight" in options) {
			this.computeWeights();
			return;
		}
		if (
			"radius" in options ||
			"radiusUnit" in options ||
			"minRadius" in options ||
			"aggregate" in options
		) {
			this.zooms.clear();
		}
		this.dirty = true;
		this.overlay.requestRender();
	}

	/** Remove the points */
	clear(): void {
		this.load([], {
			fit: false,
		});
	}

	/** Remove the layer from the map */
	destroy(): void {
		this.points = [];
		this.zooms.clear();
		this.overlay.remove(this.layer);
		if (this.renderer) {
			this.renderer.release(this.splats);
			if (this.gradient) {
				this.renderer.deleteTexture(this.gradient);
			}
		}
		this.gradient = null;
	}

	/** Fit the map to the points */
	fitBounds(padding: number | google.maps.Padding = 40): void {
		const points = this.points;
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

	private computeWeights(): void {
		const weight =
			this.opts.weight ??
			((p: T) => {
				const v = (
					p as {
						value?: unknown;
					}
				).value;
				return typeof v === "number" ? v : 1;
			});
		this.ws = Float64Array.from(this.points, (p) => weight(p));
		this.zooms.clear();
		this.dirty = true;
		this.overlay.requestRender();
	}

	/** Radius in CSS px at a zoom */
	private radiusPx(zoom: number): number {
		const r = this.opts.radius ?? 25;
		if (this.opts.radiusUnit !== "m") {
			return r;
		}
		const metersPerPx = (EARTH * Math.cos((this.latitude * Math.PI) / 180)) / (256 * 2 ** zoom);
		return Math.max(this.opts.minRadius ?? 1, r / metersPerPx);
	}

	/** Aggregation and max density of a zoom (cached) */
	private zoomData(zoom: number): ZoomData {
		let d = this.zooms.get(zoom);
		if (!d) {
			const scale = 256 * 2 ** zoom;
			const radius = this.radiusPx(zoom) / scale;
			const mode = this.opts.aggregate ?? "sum";
			const cells = aggregateHeat(this.wx, this.wy, this.ws, radius / 4, mode);
			d = {
				cells,
				max: maxHeat(cells, radius, mode),
			};
			this.zooms.set(zoom, d);
		}
		return d;
	}

	private render(r: Renderer, view: KnView): boolean {
		this.renderer = r;
		if (this.points.length === 0) {
			return false;
		}
		const zoom = Math.round(view.zoom);
		const data = this.zoomData(zoom);

		if (this.dirty || zoom !== this.zoom) {
			this.dirty = false;
			this.zoom = zoom;
			this.splats.clear();
			const { x, y, w, count } = data.cells;
			this.splats.reserve(count);
			for (let i = 0; i < count; i++) {
				pushSplat(this.splats, x[i] as number, y[i] as number, w[i] as number);
			}
		}

		// created again after a context loss (the old texture is lost with the context)
		if (!this.gradient || this.gradientGen !== r.generation) {
			this.gradient = r.createGradient(this.opts.gradient ?? KN_HEAT_GRADIENT);
			this.gradientGen = r.generation;
		}

		const max =
			this.opts.max === undefined || this.opts.max === "auto" ? data.max : this.opts.max;
		const norm = max > 0 ? (this.opts.intensity ?? 1) / max : 0;
		r.drawHeatmap(
			this.splats,
			this.gradient,
			this.radiusPx(view.zoom),
			norm,
			HEAT_K,
			this.opts.opacity ?? 0.75,
			this.opts.aggregate === "max",
		);
		return false;
	}
}
