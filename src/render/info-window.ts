/**
 * Info window: light HTML popup anchored on the map, styled with CSS (classes kn-info*,
 * CSS variables --kn-info-*). One per map, shared by every layer: opening one closes the previous.
 */

import type { KnPoint } from "../types.ts";

/** Content of an info window: HTML string or DOM node, null/undefined for none */
export type KnInfoContent = string | Node | null | undefined;

export interface KnInfoWindowOptions {
	/** extra CSS class of the root element */
	readonly className?: string;
	/** max width in CSS px (default 320) */
	readonly maxWidth?: number;
	/** close button (default true) */
	readonly closeButton?: boolean;
	/** pan the map to show the whole info window (default true) */
	readonly autoPan?: boolean;
}

/** Navigation between several items (ex: points at the same position) */
export interface KnInfoNav {
	readonly index: number;
	readonly count: number;
	/** an other item is selected: call setContent() with its content */
	onChange(index: number): void;
}

export interface KnInfoOpenOptions extends KnInfoWindowOptions {
	/** pixel offset of the tip from the position (ex: [0, -40] above a 40 px high pin) */
	readonly offset?: readonly [
		number,
		number,
	];
	readonly nav?: KnInfoNav;
	/** called when the info window is closed (or replaced by another content) */
	readonly onClose?: () => void;
}

const STYLE_ID = "kn-gmap-styles";

/** Default styles, customizable with the CSS variables or by overriding the classes */
export const KN_INFO_CSS = `
.kn-info {
	position: absolute;
	left: 0;
	top: 0;
	z-index: 10;
	box-sizing: border-box;
	min-width: 80px;
	max-width: var(--kn-info-max-width, 320px);
	padding: var(--kn-info-padding, 10px 28px 10px 12px);
	background: var(--kn-info-bg, #fff);
	color: var(--kn-info-color, #202124);
	border-radius: var(--kn-info-radius, 8px);
	box-shadow: var(--kn-info-shadow, 0 2px 7px 1px rgba(0, 0, 0, 0.3));
	font: var(--kn-info-font, 13px/1.45 Roboto, Arial, sans-serif);
	cursor: auto;
	user-select: text;
}
.kn-info__body {
	max-height: var(--kn-info-max-height, 320px);
	overflow: auto;
	overflow-wrap: break-word;
}
.kn-info__tip {
	position: absolute;
	left: 50%;
	bottom: -8px;
	width: 16px;
	height: 8px;
	margin-left: -8px;
	overflow: hidden;
}
.kn-info__tip::after {
	content: "";
	position: absolute;
	left: 2px;
	top: -6px;
	width: 12px;
	height: 12px;
	background: var(--kn-info-bg, #fff);
	transform: rotate(45deg);
	box-shadow: var(--kn-info-shadow, 0 2px 7px 1px rgba(0, 0, 0, 0.3));
}
.kn-info__close {
	position: absolute;
	top: 4px;
	right: 4px;
	width: 22px;
	height: 22px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	background: transparent;
	color: inherit;
	opacity: 0.6;
	font: 18px/22px Arial, sans-serif;
	cursor: pointer;
}
.kn-info__close:hover {
	opacity: 1;
	background: var(--kn-info-hover, rgba(0, 0, 0, 0.08));
}
.kn-info__nav {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin: 8px -16px -2px 0;
	padding-top: 6px;
	border-top: 1px solid var(--kn-info-border, rgba(0, 0, 0, 0.12));
	font-size: 12px;
	opacity: 0.85;
}
.kn-info__nav[hidden] {
	display: none;
}
.kn-info__prev,
.kn-info__next {
	width: 26px;
	height: 22px;
	padding: 0;
	border: 1px solid var(--kn-info-border, rgba(0, 0, 0, 0.15));
	border-radius: 6px;
	background: transparent;
	color: inherit;
	font: 15px/20px Arial, sans-serif;
	cursor: pointer;
}
.kn-info__prev:hover,
.kn-info__next:hover {
	background: var(--kn-info-hover, rgba(0, 0, 0, 0.08));
}
`;

function injectStyles(): void {
	if (typeof document === "undefined" || document.getElementById(STYLE_ID)) {
		return;
	}
	const style = document.createElement("style");
	style.id = STYLE_ID;
	style.textContent = KN_INFO_CSS;
	document.head.prepend(style);
}

interface Owner {
	onAdd(panes: google.maps.MapPanes | null | undefined): void;
	onDraw(projection: google.maps.MapCanvasProjection): void;
	onRemove(): void;
}

type Ctor = new (owner: Owner) => google.maps.OverlayView;
let ctor: Ctor | null = null;

function getCtor(): Ctor {
	if (!ctor) {
		ctor = class KnInfoOverlay extends google.maps.OverlayView {
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

const windows = new WeakMap<google.maps.Map, KnInfoWindow>();

export class KnInfoWindow implements Owner {
	readonly map: google.maps.Map;
	/** root element (class kn-info) */
	readonly element: HTMLDivElement;
	private readonly body: HTMLDivElement;
	private readonly nav: HTMLDivElement;
	private readonly count: HTMLSpanElement;
	private readonly closeBtn: HTMLButtonElement;
	private ov: google.maps.OverlayView | null = null;
	private position: KnPoint | null = null;
	private opts: KnInfoOpenOptions = {};
	private navState: KnInfoNav | null = null;
	private pendingPan = false;

	/** Info window of a map (created on first use) */
	static for(map: google.maps.Map): KnInfoWindow {
		let w = windows.get(map);
		if (!w) {
			w = new KnInfoWindow(map);
			windows.set(map, w);
		}
		return w;
	}

	/** Info window of a map if it exists */
	static peek(map: google.maps.Map): KnInfoWindow | undefined {
		return windows.get(map);
	}

	private constructor(map: google.maps.Map) {
		injectStyles();
		this.map = map;

		const el = document.createElement("div");
		el.className = "kn-info";
		el.innerHTML =
			'<div class="kn-info__body"></div>' +
			'<div class="kn-info__nav" hidden><button type="button" class="kn-info__prev" aria-label="Previous">‹</button>' +
			'<span class="kn-info__count"></span><button type="button" class="kn-info__next" aria-label="Next">›</button></div>' +
			'<button type="button" class="kn-info__close" aria-label="Close">×</button>' +
			'<div class="kn-info__tip"></div>';
		this.element = el;
		this.body = el.querySelector(".kn-info__body") as HTMLDivElement;
		this.nav = el.querySelector(".kn-info__nav") as HTMLDivElement;
		this.count = el.querySelector(".kn-info__count") as HTMLSpanElement;
		this.closeBtn = el.querySelector(".kn-info__close") as HTMLButtonElement;

		this.closeBtn.addEventListener("click", () => this.close());
		(el.querySelector(".kn-info__prev") as HTMLButtonElement).addEventListener("click", () =>
			this.step(-1),
		);
		(el.querySelector(".kn-info__next") as HTMLButtonElement).addEventListener("click", () =>
			this.step(1),
		);
		el.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				this.close();
			}
		});
		// clicks, drags and wheel in the info window must not reach the map
		google.maps.OverlayView.preventMapHitsAndGesturesFrom(el);
	}

	/** Is the info window opened? */
	get isOpen(): boolean {
		return this.ov !== null;
	}

	/**
	 * Open the info window (replaces the current one)
	 * @param position x = longitude, y = latitude
	 */
	open(content: string | Node, position: KnPoint, options: KnInfoOpenOptions = {}): void {
		const previous = this.opts.onClose;
		this.opts = options;
		this.position = position;
		this.navState = options.nav ?? null;
		if (previous && previous !== options.onClose) {
			previous();
		}

		const el = this.element;
		el.className = options.className ? `kn-info ${options.className}` : "kn-info";
		el.style.setProperty("--kn-info-max-width", `${options.maxWidth ?? 320}px`);
		this.closeBtn.hidden = options.closeButton === false;
		this.setContent(content);
		this.updateNav();

		this.pendingPan = options.autoPan !== false;
		if (this.ov) {
			this.redraw();
		} else {
			this.ov = new (getCtor())(this);
			this.ov.setMap(this.map);
		}
	}

	/** Replace the content (ex: on navigation) */
	setContent(content: string | Node): void {
		if (typeof content === "string") {
			this.body.innerHTML = content;
		} else {
			this.body.replaceChildren(content);
		}
	}

	/** Change the navigation state */
	setNav(nav: KnInfoNav | null): void {
		this.navState = nav;
		this.updateNav();
	}

	/** Close the info window */
	close(): void {
		if (!this.ov) {
			return;
		}
		this.ov.setMap(null);
		this.ov = null;
		const onClose = this.opts.onClose;
		this.opts = {};
		this.navState = null;
		onClose?.();
	}

	onAdd(panes: google.maps.MapPanes | null | undefined): void {
		panes?.floatPane.appendChild(this.element);
	}

	onRemove(): void {
		this.element.remove();
	}

	onDraw(projection: google.maps.MapCanvasProjection): void {
		const pos = this.position;
		if (!pos) {
			return;
		}
		const p = projection.fromLatLngToDivPixel({
			lat: pos.y,
			lng: pos.x,
		});
		if (!p) {
			return;
		}
		const [ox, oy] = this.opts.offset ?? [
			0,
			0,
		];
		// tip on the position: centered above it, 8 px for the tip
		this.element.style.transform = `translate(${Math.round(p.x + ox)}px, ${Math.round(p.y + oy - 8)}px) translate(-50%, -100%)`;

		if (this.pendingPan) {
			this.pendingPan = false;
			requestAnimationFrame(() => this.autoPan());
		}
	}

	private redraw(): void {
		const projection = this.ov?.getProjection();
		if (projection) {
			this.onDraw(projection);
		}
	}

	private updateNav(): void {
		const nav = this.navState;
		this.nav.hidden = !nav || nav.count < 2;
		if (nav) {
			this.count.textContent = `${nav.index + 1} / ${nav.count}`;
		}
	}

	private step(delta: number): void {
		const nav = this.navState;
		if (!nav || nav.count < 2) {
			return;
		}
		const index = (nav.index + delta + nav.count) % nav.count;
		this.navState = {
			...nav,
			index,
		};
		this.updateNav();
		nav.onChange(index);
		this.redraw();
	}

	/** Pan the map so that the whole info window is visible */
	private autoPan(): void {
		if (!this.ov) {
			return;
		}
		const margin = 12;
		const box = this.element.getBoundingClientRect();
		const map = this.map.getDiv().getBoundingClientRect();
		let dx = 0;
		let dy = 0;
		if (box.left < map.left + margin) {
			dx = box.left - map.left - margin;
		} else if (box.right > map.right - margin) {
			dx = box.right - map.right + margin;
		}
		if (box.top < map.top + margin) {
			dy = box.top - map.top - margin;
		} else if (box.bottom > map.bottom - margin) {
			dy = box.bottom - map.bottom + margin;
		}
		if (dx !== 0 || dy !== 0) {
			this.map.panBy(dx, dy);
		}
	}
}
