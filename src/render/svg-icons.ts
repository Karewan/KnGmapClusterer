/**
 * SVG icon builders: pins and badges with a glyph, as KnIcon (rasterized once in the atlas, then
 * drawn by the GPU: as fast as any other icon, whatever the number of markers)
 */

import type { KnImageIcon } from "./icons.ts";

/** Glyphs drawn in a 24 x 24 box (simple shapes, no external icon font) */
export const KN_GLYPHS: Readonly<Record<string, string>> = {
	car: "M5 11l1.6-4.4A2 2 0 0 1 8.5 5h7a2 2 0 0 1 1.9 1.6L19 11h.5A1.5 1.5 0 0 1 21 12.5V17h-2v1.5a1.5 1.5 0 0 1-3 0V17H8v1.5a1.5 1.5 0 0 1-3 0V17H3v-4.5A1.5 1.5 0 0 1 4.5 11zm2.1 0h9.8l-1.1-3.4a.9.9 0 0 0-.8-.6H9a.9.9 0 0 0-.8.6zM6.5 15a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zm11 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z",
	truck: "M2 6h12v9h1V9h4l3 4v4h-2a2.5 2.5 0 0 1-5 0H9a2.5 2.5 0 0 1-5 0H2zm14 5v2h4l-1.5-2zM6.5 18.2a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4zm11 0a1.2 1.2 0 1 0 0-2.4 1.2 1.2 0 0 0 0 2.4z",
	alert: "M12 2.5 22.5 21h-21zm-1 6.5v6h2V9zm0 7.5v2h2v-2z",
	home: "M12 3l9 8h-2.5v9h-5v-6h-3v6h-5v-9H3z",
	flag: "M5 3h2v18H5zm3 1h10l-2.5 4L18 12H8z",
	star: "M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z",
	bolt: "M13.5 2 5 13.5h6L9.5 22 19 9.5h-6z",
	person: "M12 3a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7zm0 9c4.4 0 7.5 2.2 7.5 5v3h-15v-3c0-2.8 3.1-5 7.5-5z",
	check: "M9.5 15.6 5.4 11.5 4 12.9l5.5 5.5L20.5 7.4 19.1 6z",
};

export interface KnSvgPinOptions {
	/** fill color */
	readonly color: string;
	/** glyph: a key of KN_GLYPHS or a SVG path (24 x 24 box) */
	readonly glyph?: string;
	readonly glyphColor?: string;
	/** height in CSS px (default 40) */
	readonly size?: number;
	/** border color (default white) */
	readonly stroke?: string;
}

export interface KnSvgBadgeOptions {
	readonly color: string;
	readonly glyph?: string;
	readonly glyphColor?: string;
	/** diameter in CSS px (default 30) */
	readonly size?: number;
	readonly shape?: "circle" | "square";
	readonly stroke?: string;
}

function glyphPath(glyph: string | undefined): string | null {
	if (!glyph) {
		return null;
	}
	return KN_GLYPHS[glyph] ?? glyph;
}

function escapeAttr(v: string): string {
	return v.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Pin icon with an optional glyph in its head
 */
function pin(o: KnSvgPinOptions): KnImageIcon {
	const h = o.size ?? 40;
	const w = Math.round((h * 30) / 42);
	const path = glyphPath(o.glyph);
	const svg = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 30 42">`,
		`<path d="M15 1C7.3 1 1 7.1 1 14.7 1 25 15 41 15 41s14-16 14-26.3C29 7.1 22.7 1 15 1z" fill="${escapeAttr(o.color)}" stroke="${escapeAttr(o.stroke ?? "#fff")}" stroke-width="2"/>`,
		path
			? `<path d="${escapeAttr(path)}" fill="${escapeAttr(o.glyphColor ?? "#fff")}" transform="translate(5.4 5.2) scale(.8)"/>`
			: `<circle cx="15" cy="14.5" r="5" fill="${escapeAttr(o.glyphColor ?? "#fff")}"/>`,
		"</svg>",
	].join("");
	return {
		url: svg,
		size: [
			w,
			h,
		],
		anchor: [
			w / 2,
			h,
		],
		labelOrigin: [
			w / 2,
			(h * 14.5) / 42,
		],
	};
}

/**
 * Round or square badge with an optional glyph, anchored at its center
 */
function badge(o: KnSvgBadgeOptions): KnImageIcon {
	const s = o.size ?? 30;
	const path = glyphPath(o.glyph);
	const shape =
		o.shape === "square"
			? `<rect x="1" y="1" width="30" height="30" rx="7" fill="${escapeAttr(o.color)}" stroke="${escapeAttr(o.stroke ?? "#fff")}" stroke-width="2"/>`
			: `<circle cx="16" cy="16" r="15" fill="${escapeAttr(o.color)}" stroke="${escapeAttr(o.stroke ?? "#fff")}" stroke-width="2"/>`;
	const svg = [
		`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 32 32">`,
		shape,
		path
			? `<path d="${escapeAttr(path)}" fill="${escapeAttr(o.glyphColor ?? "#fff")}" transform="translate(5.2 5.2) scale(.9)"/>`
			: "",
		"</svg>",
	].join("");
	return {
		url: svg,
		size: [
			s,
			s,
		],
		anchor: [
			s / 2,
			s / 2,
		],
	};
}

/** SVG icon builders */
export const knSvg: {
	readonly pin: (o: KnSvgPinOptions) => KnImageIcon;
	readonly badge: (o: KnSvgBadgeOptions) => KnImageIcon;
} = {
	pin,
	badge,
};
