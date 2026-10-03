/**
 * Helpers writing instances in the buffers
 */

import { WHITE } from "./color.ts";
import type { AtlasEntry } from "./gl/atlas.ts";
import { type InstanceBuffer, writePos } from "./gl/instances.ts";
import { C, H, L, S } from "./gl/layouts.ts";

/** Start animation of an instance: world delta from the start position, fade in */
export interface Anim {
	readonly dx: number;
	readonly dy: number;
	readonly fade: boolean;
}

/**
 * Add a sprite anchored at a world position
 * @param dx extra offset in CSS px (spiderfy...)
 */
export function pushSprite(
	buf: InstanceBuffer,
	x: number,
	y: number,
	e: AtlasEntry,
	dx = 0,
	dy = 0,
	color: number = WHITE,
	rotation = 0,
	anim: Anim | null = null,
	corner = 0,
): void {
	const o = buf.push();
	const f = buf.f32;
	writePos(f, o + S.a_posHi, x, y);
	f[o + S.a_corner] = corner;
	f[o + S.a_offset] = dx - e.anchorX;
	f[o + S.a_offset + 1] = dy - e.anchorY;
	f[o + S.a_size] = e.width;
	f[o + S.a_size + 1] = e.height;
	f[o + S.a_uv] = e.u0;
	f[o + S.a_uv + 1] = e.v0;
	f[o + S.a_uv + 2] = e.u1;
	f[o + S.a_uv + 3] = e.v1;
	buf.u32[o + S.a_color] = color;
	f[o + S.a_rotation] = rotation;
	if (anim) {
		f[o + S.a_anim] = anim.dx;
		f[o + S.a_anim + 1] = anim.dy;
		f[o + S.a_anim + 2] = anim.fade ? 1 : 0;
	}
}

export interface CircleStyle {
	readonly radius: number;
	readonly strokeWidth: number;
	readonly fill: number;
	readonly stroke: number;
	/** cumulative fractions of the donut segments (up to 4), null for a plain border */
	readonly stops: readonly number[] | null;
	readonly colors: readonly number[] | null;
}

export function pushCircle(
	buf: InstanceBuffer,
	x: number,
	y: number,
	s: CircleStyle,
	dx = 0,
	dy = 0,
	anim: Anim | null = null,
	text: AtlasEntry | null = null,
): void {
	const o = buf.push();
	const f = buf.f32;
	const u = buf.u32;
	writePos(f, o + C.a_posHi, x, y);
	if (text) {
		// text rasterized over the fill color, drawn inside the circle
		f[o + C.a_textUv] = text.u0;
		f[o + C.a_textUv + 1] = text.v0;
		f[o + C.a_textUv + 2] = text.u1;
		f[o + C.a_textUv + 3] = text.v1;
		f[o + C.a_textSize] = text.width;
		f[o + C.a_textSize + 1] = text.height;
	}
	f[o + C.a_offset] = dx;
	f[o + C.a_offset + 1] = dy;
	f[o + C.a_radius] = s.radius;
	f[o + C.a_strokeWidth] = s.strokeWidth;
	u[o + C.a_fill] = s.fill;
	u[o + C.a_stroke] = s.stroke;
	if (anim) {
		f[o + C.a_anim] = anim.dx;
		f[o + C.a_anim + 1] = anim.dy;
		f[o + C.a_anim + 2] = anim.fade ? 1 : 0;
	}
	if (s.stops && s.colors) {
		for (let i = 0; i < 4; i++) {
			// last stop always 1 (> 0 enables the donut)
			f[o + C.a_stops + i] = i === 3 ? 1 : (s.stops[i] ?? 1);
			u[o + C.a_c0 + i] = s.colors[i] ?? s.colors[s.colors.length - 1] ?? s.stroke;
		}
	}
}

export function pushLine(
	buf: InstanceBuffer,
	ax: number,
	ay: number,
	bx: number,
	by: number,
	color: number,
	width: number,
): void {
	const o = buf.push();
	const f = buf.f32;
	writePos(f, o + L.a_aHi, ax, ay);
	writePos(f, o + L.a_bHi, bx, by);
	buf.u32[o + L.a_color] = color;
	f[o + L.a_width] = width;
}

/** Add a polygon vertex */
export function pushVertex(buf: InstanceBuffer, x: number, y: number): void {
	writePos(buf.f32, buf.push(), x, y);
}

/** Add a heatmap splat */
export function pushSplat(buf: InstanceBuffer, x: number, y: number, weight: number): void {
	const o = buf.push();
	writePos(buf.f32, o + H.a_posHi, x, y);
	buf.f32[o + H.a_weight] = weight;
}
