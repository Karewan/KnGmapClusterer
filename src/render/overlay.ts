/**
 * One WebGL2 canvas per map, inside a google.maps.OverlayView, shared by all the layers of the map.
 *
 * The canvas lives in the overlayLayer pane: on raster maps it follows the panning and the CSS zoom
 * animation of the tiles, and it is re-rendered in draw() (called by the map on every move).
 * No mapId / vector map required.
 */

import { latY, lngX } from "../core/mercator.ts";
import { Renderer } from "./gl/renderer.ts";
import { onImageLoaded } from "./icons.ts";
import { KnInfoWindow } from "./info-window.ts";
import { createView, type KnView } from "./view.ts";

/** Pointer event dispatched to the layers */
export interface KnPointer {
	/** world position */
	readonly x: number;
	readonly y: number;
	readonly latLng: google.maps.LatLng | null;
	readonly domEvent: Event | null;
}

/** A layer drawn by the overlay */
export interface OverlayLayer {
	readonly zIndex: number;
	/**
	 * Draw the layer
	 * @returns true if another frame is needed (animation)
	 */
	render(renderer: Renderer, view: KnView): boolean;
	/** Item under the pointer, -1 if none */
	hitTest(view: KnView, x: number, y: number): number;
	/** Click on an item returned by hitTest */
	click(hit: number, e: KnPointer, view: KnView): void;
	/** Pointer entering an item (hit >= 0) or leaving it (hit = -1) */
	hover(hit: number, e: KnPointer | null): void;
	/** Everything must be rebuilt (icon loaded, context restored...) */
	invalidate(): void;
	/** The map zoom changed */
	zoomChanged?(): void;
	/** Click on the map outside of any item */
	clickEmpty?(e: KnPointer): void;
	/** Remove the layer and free its resources */
	destroy(): void;
}

interface OverlayOwner {
	onAdd(panes: google.maps.MapPanes | null | undefined): void;
	onDraw(projection: google.maps.MapCanvasProjection): void;
	onRemove(): void;
}

type OverlayCtor = new (owner: OverlayOwner) => google.maps.OverlayView;
let overlayCtor: OverlayCtor | null = null;

/** google.maps.OverlayView only exists once the API is loaded: define the class lazily */
function getOverlayCtor(): OverlayCtor {
	if (!overlayCtor) {
		overlayCtor = class KnOverlayView extends google.maps.OverlayView {
			private readonly owner: OverlayOwner;

			constructor(owner: OverlayOwner) {
				super();
				this.owner = owner;
			}

			override onAdd(): void {
				this.owner.onAdd(this.getPanes());
			}

			override draw(): void {
				this.owner.onDraw(this.getProjection());
			}

			override onRemove(): void {
				this.owner.onRemove();
			}
		};
	}
	return overlayCtor;
}

const overlays = new WeakMap<google.maps.Map, KnOverlay>();

/** Max size of the canvas in device px (also limited by the GPU) */
const MAX_CANVAS = 8192;

export class KnOverlay implements OverlayOwner {
	readonly map: google.maps.Map;
	/** Extra area rendered around the viewport (fraction of its size), covers the zoom-out animation */
	margin = 0.15;
	view: KnView | null = null;
	renderer: Renderer | null = null;
	/** duration of the last frame (CPU side, ms) */
	frameTime = 0;
	/** max canvas size in device px */
	private maxCanvas = 4096;

	private readonly canvas: HTMLCanvasElement;
	private readonly ov: google.maps.OverlayView;
	private readonly layers: OverlayLayer[] = [];
	private readonly listeners: google.maps.MapsEventListener[] = [];
	private readonly unsubscribe: () => void;
	private frame = 0;
	private lost = false;
	private hovered: {
		layer: OverlayLayer;
		hit: number;
	} | null = null;
	private cursor: string | null | undefined;

	/** Overlay of a map (created on first use) */
	static for(map: google.maps.Map): KnOverlay {
		let o = overlays.get(map);
		if (!o) {
			o = new KnOverlay(map);
			overlays.set(map, o);
		}
		return o;
	}

	/** Overlay of a map if it exists */
	static peek(map: google.maps.Map): KnOverlay | undefined {
		return overlays.get(map);
	}

	private constructor(map: google.maps.Map) {
		this.map = map;
		this.canvas = document.createElement("canvas");
		this.canvas.className = "kn-gmap-canvas";
		Object.assign(this.canvas.style, {
			position: "absolute",
			left: "0",
			top: "0",
			pointerEvents: "none",
			transformOrigin: "0 0",
		});

		const gl = this.canvas.getContext("webgl2", {
			alpha: true,
			antialias: false,
			premultipliedAlpha: true,
			preserveDrawingBuffer: false,
			// zones: polygons filled with the stencil buffer
			stencil: true,
		});
		if (gl) {
			const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
			this.maxCanvas = Math.min(
				MAX_CANVAS,
				Number(gl.getParameter(gl.MAX_RENDERBUFFER_SIZE)) || 4096,
				dims?.[0] ?? 4096,
				dims?.[1] ?? 4096,
			);
			this.renderer = new Renderer(gl, window.devicePixelRatio || 1);
		} else {
			console.error("KnGmapClusterer: WebGL2 is not available, nothing will be drawn");
		}

		this.canvas.addEventListener("webglcontextlost", (e) => {
			e.preventDefault();
			this.lost = true;
		});
		this.canvas.addEventListener("webglcontextrestored", () => {
			const gl2 = this.canvas.getContext("webgl2");
			if (gl2 && this.renderer) {
				this.renderer.restore(gl2);
				this.lost = false;
				this.invalidate();
			}
		});

		this.unsubscribe = onImageLoaded(() => this.invalidate());

		// texts are rasterized: redraw them when a web font (ex: Roboto loaded by the map) is ready
		document.fonts?.addEventListener("loadingdone", () => {
			this.renderer?.atlas.reset();
			this.invalidate();
		});

		this.listeners.push(
			map.addListener("click", (e: google.maps.MapMouseEvent) => this.onClick(e)),
			map.addListener("mousemove", (e: google.maps.MapMouseEvent) => this.onMove(e)),
			map.addListener("mouseout", () => this.setHovered(null, null)),
			map.addListener("zoom_changed", () => {
				for (const l of this.layers) {
					l.zoomChanged?.();
				}
			}),
			map.addListener("bounds_changed", () => this.requestRender()),
		);

		const Ctor = getOverlayCtor();
		this.ov = new Ctor(this);
		this.ov.setMap(map);
	}

	/** Add a layer */
	add(layer: OverlayLayer): void {
		if (!this.layers.includes(layer)) {
			this.layers.push(layer);
			this.layers.sort((a, b) => a.zIndex - b.zIndex);
		}
		this.requestRender();
	}

	/** Remove a layer (without destroying it) */
	remove(layer: OverlayLayer): void {
		const i = this.layers.indexOf(layer);
		if (i >= 0) {
			this.layers.splice(i, 1);
		}
		if (this.hovered?.layer === layer) {
			this.setHovered(null, null);
		}
		this.requestRender();
	}

	/** Destroy every layer of the map (used when a map instance is released) */
	clearLayers(): void {
		for (const l of [
			...this.layers,
		]) {
			l.destroy();
		}
		this.layers.length = 0;
		this.requestRender();
	}

	/** Re-sort the layers (zIndex changed) */
	sort(): void {
		this.layers.sort((a, b) => a.zIndex - b.zIndex);
		this.requestRender();
	}

	/** Every layer must rebuild its instances */
	invalidate(): void {
		for (const l of this.layers) {
			l.invalidate();
		}
		this.requestRender();
	}

	/** Schedule a render on the next animation frame */
	requestRender(): void {
		if (this.frame === 0 && typeof requestAnimationFrame !== "undefined") {
			this.frame = requestAnimationFrame(() => {
				this.frame = 0;
				const projection = this.ov.getProjection();
				if (projection) {
					this.onDraw(projection);
				}
			});
		}
	}

	/** Remove the overlay from the map */
	destroy(): void {
		this.clearLayers();
		for (const l of this.listeners) {
			l.remove();
		}
		this.unsubscribe();
		if (this.frame) {
			cancelAnimationFrame(this.frame);
		}
		this.ov.setMap(null);
		overlays.delete(this.map);
	}

	onAdd(panes: google.maps.MapPanes | null | undefined): void {
		panes?.overlayLayer.appendChild(this.canvas);
	}

	onRemove(): void {
		this.canvas.remove();
	}

	onDraw(projection: google.maps.MapCanvasProjection): void {
		if (this.frame) {
			cancelAnimationFrame(this.frame);
			this.frame = 0;
		}

		const div = this.map.getDiv();
		const w = div.clientWidth;
		const h = div.clientHeight;
		if (w === 0 || h === 0) {
			return;
		}

		// Everything is derived from the projection (the one used by the panes for this frame):
		// map.getCenter() / getZoom() can already hold the next state during a transition
		const center = projection.fromContainerPixelToLatLng(new google.maps.Point(w / 2, h / 2));
		const east = projection.fromContainerPixelToLatLng(
			new google.maps.Point(w / 2 + 256, h / 2),
		);
		if (!center || !east) {
			return;
		}
		let span = lngX(east.lng()) - lngX(center.lng());
		if (span <= 0) {
			span += 1;
		}
		let zoom = Math.log2(1 / span);
		// raster maps: integer zooms
		if (Math.abs(zoom - Math.round(zoom)) < 1e-6) {
			zoom = Math.round(zoom);
		}

		const dp = projection.fromLatLngToDivPixel(center);
		if (!dp) {
			return;
		}
		const cp = {
			x: w / 2,
			y: h / 2,
		};

		// Sharpness: keep the full pixel ratio, reduce the margin first if the canvas is too big
		const ratio = window.devicePixelRatio || 1;
		const max = this.maxCanvas;
		const margin = Math.max(
			0,
			Math.min(this.margin, (max / ratio / w - 1) / 2, (max / ratio / h - 1) / 2),
		);
		const mx = Math.round(w * margin);
		const my = Math.round(h * margin);
		const dpr = Math.min(ratio, max / (w + 2 * mx), max / (h + 2 * my));
		const bw = Math.round((w + 2 * mx) * dpr);
		const bh = Math.round((h + 2 * my) * dpr);
		// CSS size of exactly bw x bh device pixels (no resampling by the browser)
		const cw = bw / dpr;
		const ch = bh / dpr;

		const c = this.canvas;
		if (c.width !== bw || c.height !== bh) {
			c.width = bw;
			c.height = bh;
			c.style.width = `${cw}px`;
			c.style.height = `${ch}px`;
		}

		// container (0, 0) in div pixels
		const ox = dp.x - cp.x;
		const oy = dp.y - cp.y;
		// align the canvas on the device pixels, in the coordinates of the pane: with an odd map size
		// the pane is at a half pixel, but Chrome composites it as a layer snapped to the pixel grid,
		// so the canvas must be on whole device pixels inside the pane (else it is resampled: blurry)
		const tx = Math.round((ox - mx) * dpr) / dpr;
		const ty = Math.round((oy - my) * dpr) / dpr;
		c.style.transform = `translate(${tx}px, ${ty}px)`;

		// world position of the canvas center (the map center is at dp in div pixels)
		const scale = 256 * 2 ** zoom;
		const cx = lngX(center.lng()) + (tx + cw / 2 - dp.x) / scale;
		const cy = latY(center.lat()) + (ty + ch / 2 - dp.y) / scale;

		this.view = createView(zoom, cx, cy, cw, ch, dpr, performance.now());
		this.render();
	}

	private render(): void {
		const r = this.renderer;
		const view = this.view;
		if (!r || !view || this.lost) {
			return;
		}

		if (Math.abs(r.atlas.dpr - view.dpr) > 1e-3) {
			r.atlas.reset(view.dpr);
		}

		const t0 = performance.now();
		r.begin(view);
		let again = false;
		for (const layer of this.layers) {
			if (layer.render(r, view)) {
				again = true;
			}
		}
		this.frameTime = performance.now() - t0;
		if (again) {
			this.requestRender();
		}
	}

	private pointer(e: google.maps.MapMouseEvent): KnPointer | null {
		if (!e.latLng) {
			return null;
		}
		return {
			x: lngX(e.latLng.lng()),
			y: latY(e.latLng.lat()),
			latLng: e.latLng,
			domEvent: (e.domEvent as Event | undefined) ?? null,
		};
	}

	private hitTest(p: KnPointer): {
		layer: OverlayLayer;
		hit: number;
	} | null {
		const view = this.view;
		if (!view) {
			return null;
		}
		for (let i = this.layers.length - 1; i >= 0; i--) {
			const layer = this.layers[i] as OverlayLayer;
			const hit = layer.hitTest(view, p.x, p.y);
			if (hit >= 0) {
				return {
					layer,
					hit,
				};
			}
		}
		return null;
	}

	private onClick(e: google.maps.MapMouseEvent): void {
		const p = this.pointer(e);
		const view = this.view;
		if (!p || !view) {
			return;
		}
		// a click on the map (empty place or another item) closes the opened info window
		KnInfoWindow.peek(this.map)?.close();
		const found = this.hitTest(p);
		for (const l of this.layers) {
			if (l !== found?.layer) {
				l.clickEmpty?.(p);
			}
		}
		if (found) {
			found.layer.click(found.hit, p, view);
		}
	}

	private onMove(e: google.maps.MapMouseEvent): void {
		const p = this.pointer(e);
		this.setHovered(p ? this.hitTest(p) : null, p);
	}

	private setHovered(
		found: {
			layer: OverlayLayer;
			hit: number;
		} | null,
		p: KnPointer | null,
	): void {
		const prev = this.hovered;
		if (prev?.layer === found?.layer && prev?.hit === found?.hit) {
			return;
		}
		prev?.layer.hover(-1, p);
		this.hovered = found;
		found?.layer.hover(found.hit, p);

		// pointer cursor over the items
		if (found && !prev) {
			this.cursor = this.map.get("draggableCursor") as string | null | undefined;
			this.map.setOptions({
				draggableCursor: "pointer",
			});
		} else if (!found && prev) {
			this.map.setOptions({
				draggableCursor: this.cursor ?? null,
			});
		}
	}
}
