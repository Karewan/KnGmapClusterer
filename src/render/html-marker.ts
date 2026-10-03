/**
 * Free HTML marker (popup, rich marker...) positioned on the map with an OverlayView.
 * No mapId / AdvancedMarkerElement needed. Meant for a few elements: use the WebGL layers for
 * big numbers of markers.
 */

import type { KnPoint } from "../types.ts";

export type KnHtmlAnchor =
	| "center"
	| "top"
	| "bottom"
	| "left"
	| "right"
	| "top-left"
	| "top-right"
	| "bottom-left"
	| "bottom-right";

export interface KnHtmlMarkerOptions {
	/** x = longitude, y = latitude */
	readonly position: KnPoint;
	/** content (element or HTML string) */
	readonly content?: HTMLElement | string;
	/** point of the content placed on the position (default 'bottom') */
	readonly anchor?: KnHtmlAnchor;
	/** extra offset in CSS px */
	readonly offset?: readonly [
		number,
		number,
	];
	readonly zIndex?: number;
	/** pane of the map (default 'floatPane': above everything, receives the events) */
	readonly pane?: keyof google.maps.MapPanes;
}

const TRANSLATE: Record<KnHtmlAnchor, string> = {
	center: "-50%, -50%",
	top: "-50%, 0",
	bottom: "-50%, -100%",
	left: "0, -50%",
	right: "-100%, -50%",
	"top-left": "0, 0",
	"top-right": "-100%, 0",
	"bottom-left": "0, -100%",
	"bottom-right": "-100%, -100%",
};

interface Owner {
	onAdd(panes: google.maps.MapPanes | null | undefined): void;
	onDraw(projection: google.maps.MapCanvasProjection): void;
	onRemove(): void;
}

type Ctor = new (owner: Owner) => google.maps.OverlayView;
let ctor: Ctor | null = null;

function getCtor(): Ctor {
	if (!ctor) {
		ctor = class KnHtmlOverlay extends google.maps.OverlayView {
			private readonly owner: Owner;

			constructor(owner: Owner) {
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
	return ctor;
}

export class KnHtmlMarker implements Owner {
	/** element holding the content */
	readonly element: HTMLDivElement;
	private opts: KnHtmlMarkerOptions;
	private readonly ov: google.maps.OverlayView;

	constructor(map: google.maps.Map, options: KnHtmlMarkerOptions) {
		this.opts = options;
		this.element = document.createElement("div");
		this.element.className = "kn-gmap-html-marker";
		this.element.style.position = "absolute";
		this.element.style.left = "0";
		this.element.style.top = "0";
		// clicks on the marker must not reach the map
		google.maps.OverlayView.preventMapHitsAndGesturesFrom(this.element);
		this.setContent(options.content ?? "");
		this.ov = new (getCtor())(this);
		this.ov.setMap(map);
	}

	setPosition(position: KnPoint): void {
		this.opts = {
			...this.opts,
			position,
		};
		this.redraw();
	}

	setOptions(options: Partial<KnHtmlMarkerOptions>): void {
		this.opts = {
			...this.opts,
			...options,
		};
		if (options.content !== undefined) {
			this.setContent(options.content);
		}
		this.redraw();
	}

	setContent(content: HTMLElement | string): void {
		if (typeof content === "string") {
			this.element.innerHTML = content;
		} else {
			this.element.replaceChildren(content);
		}
	}

	/** Remove the marker from the map */
	destroy(): void {
		this.ov.setMap(null);
	}

	onAdd(panes: google.maps.MapPanes | null | undefined): void {
		panes?.[this.opts.pane ?? "floatPane"].appendChild(this.element);
	}

	onRemove(): void {
		this.element.remove();
	}

	onDraw(projection: google.maps.MapCanvasProjection): void {
		const {
			position,
			anchor = "bottom",
			offset = [
				0,
				0,
			],
			zIndex,
		} = this.opts;
		const p = projection.fromLatLngToDivPixel({
			lat: position.y,
			lng: position.x,
		});
		if (!p) {
			return;
		}
		this.element.style.transform = `translate(${p.x + offset[0]}px, ${p.y + offset[1]}px) translate(${TRANSLATE[anchor]})`;
		this.element.style.zIndex = zIndex === undefined ? "" : String(zIndex);
	}

	private redraw(): void {
		const projection = this.ov.getProjection();
		if (projection) {
			this.onDraw(projection);
		}
	}
}
