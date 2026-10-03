/**
 * CSS colors to packed RGBA (uint32, little endian => bytes r, g, b, a in memory),
 * read in the shaders as a normalized UNSIGNED_BYTE vec4.
 */

const cache = new Map<string, number>();
let ctx: CanvasRenderingContext2D | null | undefined;

function pack(r: number, g: number, b: number, a: number): number {
	return ((r & 255) | ((g & 255) << 8) | ((b & 255) << 16) | ((a & 255) << 24)) >>> 0;
}

function parseHex(hex: string): number | null {
	let h = hex.slice(1);
	if (h.length === 3 || h.length === 4) {
		h = [
			...h,
		]
			.map((c) => c + c)
			.join("");
	}
	if ((h.length !== 6 && h.length !== 8) || !/^[0-9a-f]+$/i.test(h)) {
		return null;
	}
	const v = Number.parseInt(h, 16);
	return h.length === 6 ? pack(v >>> 16, v >>> 8, v, 255) : pack(v >>> 24, v >>> 16, v >>> 8, v);
}

function parseRgb(css: string): number | null {
	const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(
		css,
	);
	if (!m) {
		return null;
	}
	let a = 255;
	if (m[4] !== undefined) {
		a = m[4].endsWith("%")
			? (Number.parseFloat(m[4]) / 100) * 255
			: Number.parseFloat(m[4]) * 255;
	}
	return pack(
		Math.round(Number(m[1])),
		Math.round(Number(m[2])),
		Math.round(Number(m[3])),
		Math.round(a),
	);
}

function parseWithCanvas(css: string): number | null {
	if (ctx === undefined) {
		ctx =
			typeof document === "undefined"
				? null
				: document.createElement("canvas").getContext("2d");
	}
	if (!ctx) {
		return null;
	}
	ctx.fillStyle = "#000";
	ctx.fillStyle = css;
	const normalized = ctx.fillStyle;
	return normalized.startsWith("#") ? parseHex(normalized) : parseRgb(normalized);
}

/**
 * Parse any CSS color (hex, rgb(), rgba(), named colors in a browser)
 * @returns the packed color, opaque black if invalid
 */
export function parseColor(css: string): number {
	const cached = cache.get(css);
	if (cached !== undefined) {
		return cached;
	}
	const c = css.trim();
	const v =
		(c.startsWith("#") ? parseHex(c) : null) ??
		(c.startsWith("rgb") ? parseRgb(c) : null) ??
		(c === "transparent" ? 0 : null) ??
		parseWithCanvas(c) ??
		pack(0, 0, 0, 255);
	if (cache.size > 1000) {
		cache.clear();
	}
	cache.set(css, v);
	return v;
}

export const WHITE: number = pack(255, 255, 255, 255);
export const TRANSPARENT = 0;
