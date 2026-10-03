/**
 * Icons and texts rasterized in the atlas
 */

import type { Atlas, AtlasEntry } from "./gl/atlas.ts";

/** Image icon */
export interface KnImageIcon {
	/** image URL (or data URI) */
	readonly url: string;
	/** displayed size in CSS px, default: natural size of the image */
	readonly size?: readonly [
		number,
		number,
	];
	/** anchor in CSS px from the top left corner, default: bottom center */
	readonly anchor?: readonly [
		number,
		number,
	];
	/** label center in CSS px from the top left corner, default: center */
	readonly labelOrigin?: readonly [
		number,
		number,
	];
}

/** Built-in pin icon (drawn, no request) */
export interface KnPinIcon {
	/** fill color */
	readonly pin: string;
	/** height in CSS px (default 40) */
	readonly size?: number;
	/** border color (default: darker fill) */
	readonly stroke?: string;
	/** color of the center dot, null to hide it (default white) */
	readonly dot?: string | null;
}

/** Built-in circle icon (drawn, no request) */
export interface KnCircleIcon {
	/** fill color */
	readonly circle: string;
	/** radius in CSS px (default 6) */
	readonly radius?: number;
	/** border color (default white) */
	readonly stroke?: string;
	/** border width in CSS px (default 2) */
	readonly strokeWidth?: number;
}

/**
 * An icon: URL / raw SVG string, image options, built-in pin or circle
 */
export type KnIcon = string | KnImageIcon | KnPinIcon | KnCircleIcon;

/** Text style */
export interface KnFont {
	readonly color?: string;
	/** size in CSS px */
	readonly size?: number;
	readonly family?: string;
	readonly weight?: string | number;
	/** halo (outline) color for readability, null for none */
	readonly halo?: string | null;
	/** halo width in CSS px (default 2) */
	readonly haloWidth?: number;
}

export interface ResolvedFont {
	readonly color: string;
	readonly size: number;
	readonly family: string;
	readonly weight: string | number;
	readonly halo: string | null;
	readonly haloWidth: number;
}

export function resolveFont(font: KnFont | undefined, defaults: ResolvedFont): ResolvedFont {
	return {
		color: font?.color ?? defaults.color,
		size: font?.size ?? defaults.size,
		family: font?.family ?? defaults.family,
		weight: font?.weight ?? defaults.weight,
		halo: font?.halo === undefined ? defaults.halo : font.halo,
		haloWidth: font?.haloWidth ?? defaults.haloWidth,
	};
}

const PIN_PATH = "M12 0C5.37 0 0 5.37 0 12c0 9 12 24 12 24s12-15 12-24C24 5.37 18.63 0 12 0z";

interface LoadedImage {
	readonly img: HTMLImageElement | null;
	readonly width: number;
	readonly height: number;
}

/** Shared image cache (survives atlas resets) */
const images = new Map<string, LoadedImage | Promise<void>>();
const listeners = new Set<() => void>();

/** Be notified when an image finished loading (to redraw) */
export function onImageLoaded(cb: () => void): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

function toUrl(src: string): string {
	return src.trimStart().startsWith("<svg")
		? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`
		: src;
}

function loadImage(url: string): LoadedImage | null {
	const cached = images.get(url);
	if (cached && !(cached instanceof Promise)) {
		return cached;
	}
	if (!cached) {
		const img = new Image();
		img.crossOrigin = "anonymous";
		img.decoding = "async";
		img.src = url;
		const p = img
			.decode()
			.then(() => {
				images.set(url, {
					img,
					width: img.naturalWidth || 32,
					height: img.naturalHeight || 32,
				});
			})
			.catch(() => {
				console.warn(`KnGmapClusterer: unable to load the icon ${url.slice(0, 100)}`);
				images.set(url, {
					img: null,
					width: 0,
					height: 0,
				});
			})
			.finally(() => {
				for (const cb of listeners) {
					cb();
				}
			});
		images.set(url, p);
	}
	return null;
}

function isImage(icon: KnIcon): icon is KnImageIcon {
	return typeof icon === "object" && "url" in icon;
}

function isPin(icon: KnIcon): icon is KnPinIcon {
	return typeof icon === "object" && "pin" in icon;
}

/** Unique key of an icon */
export function iconKey(icon: KnIcon): string {
	if (typeof icon === "string") {
		return `u|${icon}`;
	}
	if (isImage(icon)) {
		return `u|${icon.url}|${icon.size?.join(",") ?? ""}|${icon.anchor?.join(",") ?? ""}|${icon.labelOrigin?.join(",") ?? ""}`;
	}
	if (isPin(icon)) {
		return `p|${icon.pin}|${icon.size ?? ""}|${icon.stroke ?? ""}|${icon.dot ?? ""}`;
	}
	return `c|${icon.circle}|${icon.radius ?? ""}|${icon.stroke ?? ""}|${icon.strokeWidth ?? ""}`;
}

/**
 * Get (rasterize if needed) the atlas entry of an icon
 * @returns null while the image is loading or if it failed
 */
export function getIcon(
	atlas: Atlas,
	icon: KnIcon,
	key: string = iconKey(icon),
): AtlasEntry | null {
	const existing = atlas.get(key);
	if (existing) {
		return existing;
	}

	if (typeof icon === "string" || isImage(icon)) {
		const opts: KnImageIcon =
			typeof icon === "string"
				? {
						url: icon,
					}
				: icon;
		const loaded = loadImage(toUrl(opts.url));
		if (!loaded?.img) {
			return null;
		}
		const img = loaded.img;
		const [w, h] = opts.size ?? [
			loaded.width,
			loaded.height,
		];
		const [ax, ay] = opts.anchor ?? [
			w / 2,
			h,
		];
		const [lx, ly] = opts.labelOrigin ?? [
			w / 2,
			h / 2,
		];
		return atlas.add(
			key,
			{
				width: w,
				height: h,
				anchorX: ax,
				anchorY: ay,
				labelX: lx,
				labelY: ly,
			},
			(ctx) => ctx.drawImage(img, 0, 0, w, h),
		);
	}

	if (isPin(icon)) {
		const h = icon.size ?? 40;
		const scale = h / 36;
		const w = 24 * scale;
		const pad = 1;
		return atlas.add(
			key,
			{
				width: w + 2 * pad,
				height: h + 2 * pad,
				anchorX: w / 2 + pad,
				anchorY: h + pad,
				labelX: w / 2 + pad,
				labelY: 12 * scale + pad,
			},
			(ctx) => {
				ctx.translate(pad, pad);
				ctx.scale(scale, scale);
				const path = new Path2D(PIN_PATH);
				ctx.fillStyle = icon.pin;
				ctx.fill(path);
				ctx.lineWidth = 1.5 / scale;
				ctx.strokeStyle = icon.stroke ?? "rgba(0,0,0,0.35)";
				ctx.stroke(path);
				if (icon.dot !== null) {
					ctx.beginPath();
					ctx.arc(12, 12, 4.5, 0, Math.PI * 2);
					ctx.fillStyle = icon.dot ?? "#fff";
					ctx.fill();
				}
			},
		);
	}

	const r = icon.radius ?? 6;
	const sw = icon.strokeWidth ?? 2;
	const size = 2 * (r + sw) + 2;
	return atlas.add(
		key,
		{
			width: size,
			height: size,
			anchorX: size / 2,
			anchorY: size / 2,
			labelX: size / 2,
			labelY: size / 2,
		},
		(ctx) => {
			ctx.beginPath();
			ctx.arc(size / 2, size / 2, r + sw / 2, 0, Math.PI * 2);
			ctx.fillStyle = icon.circle;
			ctx.fill();
			if (sw > 0) {
				ctx.lineWidth = sw;
				ctx.strokeStyle = icon.stroke ?? "#fff";
				ctx.stroke();
			}
		},
	);
}

function cssFont(font: ResolvedFont): string {
	return `${font.weight} ${font.size}px ${font.family}`;
}

/**
 * Get (rasterize if needed) a text, anchored at its center
 * @param background opaque background color: the text gets the sub-pixel (LCD) anti-aliasing of
 * the system texts, sharper than the grayscale anti-aliasing of a transparent text
 */
export function getText(
	atlas: Atlas,
	text: string,
	font: ResolvedFont,
	background: string | null = null,
	box: {
		readonly padX: number;
		readonly height: number;
	} | null = null,
): AtlasEntry {
	const key = `t|${font.color}|${font.size}|${font.family}|${font.weight}|${font.halo ?? ""}|${font.haloWidth}|${background ?? ""}|${box ? `${box.padX}x${box.height}` : ""}|${text}`;
	const existing = atlas.get(key);
	if (existing) {
		return existing;
	}

	const ctx = atlas.measureContext();
	ctx.font = cssFont(font);
	const m = ctx.measureText(text);
	const halo = font.halo ? font.haloWidth : 0;
	const pad = halo + 1;
	// ink box: centered visually (digits have no descender)
	const left = m.actualBoundingBoxLeft;
	const ascent = m.actualBoundingBoxAscent;
	const inkW = Math.ceil(left + m.actualBoundingBoxRight);
	const inkH = Math.ceil(ascent + m.actualBoundingBoxDescent);
	// box: fixed height and horizontal padding (labels in a pill)
	const padX = box ? box.padX : pad;
	const w = inkW + 2 * padX;
	const h = box ? Math.max(box.height, inkH + 2) : inkH + 2 * pad;
	const top = box ? (h - inkH) / 2 : pad;
	const dpr = atlas.dpr;
	// glyph origin on a whole device pixel: a fractional position blurs the text
	const x = Math.round((padX + left) * dpr) / dpr;
	const y = Math.round((top + ascent) * dpr) / dpr;

	return atlas.add(
		key,
		{
			width: w,
			height: h,
			anchorX: w / 2,
			anchorY: h / 2,
			labelX: w / 2,
			labelY: h / 2,
		},
		(c, width, height) => {
			if (background) {
				c.fillStyle = background;
				c.fillRect(0, 0, width + 1, height + 1);
			}
			c.font = cssFont(font);
			c.textAlign = "left";
			c.textBaseline = "alphabetic";
			if (font.halo) {
				c.lineJoin = "round";
				c.lineWidth = font.haloWidth * 2;
				c.strokeStyle = font.halo;
				c.strokeText(text, x, y);
			}
			c.fillStyle = font.color;
			c.fillText(text, x, y);
		},
		background !== null,
	);
}

/**
 * Get (rasterize if needed) the direction arrow of the routes: a filled arrowhead pointing right,
 * with an outline for the contrast on any line color
 */
export function getArrow(atlas: Atlas, size: number, fill: string, outline: string): AtlasEntry {
	const w = size + 4;
	const h = size + 4;
	return atlas.add(
		`a|${size}|${fill}|${outline}`,
		{
			width: w,
			height: h,
			anchorX: w / 2,
			anchorY: h / 2,
			labelX: w / 2,
			labelY: h / 2,
		},
		(ctx) => {
			const s = size;
			ctx.translate(2, 2);
			ctx.beginPath();
			ctx.moveTo(s * 0.08, s * 0.1);
			ctx.lineTo(s * 0.95, s * 0.5);
			ctx.lineTo(s * 0.08, s * 0.9);
			ctx.lineTo(s * 0.32, s * 0.5);
			ctx.closePath();
			ctx.lineJoin = "round";
			ctx.lineWidth = Math.max(1.5, s * 0.12);
			ctx.strokeStyle = outline;
			ctx.stroke();
			ctx.fillStyle = fill;
			ctx.fill();
		},
	);
}
