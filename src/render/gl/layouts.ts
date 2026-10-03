/**
 * Instance attribute layouts. Every attribute is 4 bytes per component:
 * - 'f': float32 components
 * - 'c': one packed RGBA color (4 x uint8, normalized)
 */

export interface AttribDef {
	readonly name: string;
	readonly type: "f" | "c";
	/** number of float components (ignored for 'c') */
	readonly size: number;
}

export interface Layout {
	readonly attribs: readonly AttribDef[];
	/** stride in 4 bytes slots */
	readonly stride: number;
	/** offset (in slots) of each attribute */
	readonly offsets: Readonly<Record<string, number>>;
	/** attributes per vertex (not per instance) */
	readonly perVertex: boolean;
}

function layout(attribs: AttribDef[], perVertex = false): Layout {
	const offsets: Record<string, number> = {};
	let stride = 0;
	for (const a of attribs) {
		offsets[a.name] = stride;
		stride += a.type === "c" ? 1 : a.size;
	}
	return {
		attribs,
		stride,
		offsets,
		perVertex,
	};
}

const f = (name: string, size: number): AttribDef => ({
	name,
	type: "f",
	size,
});
const c = (name: string): AttribDef => ({
	name,
	type: "c",
	size: 4,
});

/** Textured quads: icons, texts, arrows */
export const SPRITE: Layout = layout([
	f("a_posHi", 2),
	f("a_posLo", 2),
	f("a_offset", 2),
	f("a_size", 2),
	f("a_uv", 4),
	c("a_color"),
	f("a_rotation", 1),
	f("a_anim", 3),
	// corner radius in CSS px (rounded rectangles: labels)
	f("a_corner", 1),
]);

/** Anti-aliased circles with border or donut, and an optional text */
export const CIRCLE: Layout = layout([
	f("a_posHi", 2),
	f("a_posLo", 2),
	f("a_offset", 2),
	f("a_radius", 1),
	f("a_strokeWidth", 1),
	c("a_fill"),
	c("a_stroke"),
	f("a_anim", 3),
	f("a_stops", 4),
	c("a_c0"),
	c("a_c1"),
	c("a_c2"),
	c("a_c3"),
	// text rasterized over the fill color (sub-pixel anti-aliasing), drawn inside the circle
	f("a_textUv", 4),
	f("a_textSize", 2),
]);

/** Polygons vertices (filled with the stencil buffer) */
export const POLY: Layout = layout(
	[
		f("a_posHi", 2),
		f("a_posLo", 2),
	],
	true,
);

/** Heatmap splats */
export const HEAT: Layout = layout([
	f("a_posHi", 2),
	f("a_posLo", 2),
	f("a_weight", 1),
]);

/** Thick segments with round caps */
export const LINE: Layout = layout([
	f("a_aHi", 2),
	f("a_aLo", 2),
	f("a_bHi", 2),
	f("a_bLo", 2),
	c("a_color"),
	f("a_width", 1),
]);

// Offsets used when writing the instances
export const S = SPRITE.offsets as {
	a_posHi: number;
	a_offset: number;
	a_size: number;
	a_uv: number;
	a_color: number;
	a_rotation: number;
	a_anim: number;
	a_corner: number;
};

export const C = CIRCLE.offsets as {
	a_posHi: number;
	a_offset: number;
	a_radius: number;
	a_strokeWidth: number;
	a_fill: number;
	a_stroke: number;
	a_anim: number;
	a_stops: number;
	a_c0: number;
	a_textUv: number;
	a_textSize: number;
};

export const L = LINE.offsets as {
	a_aHi: number;
	a_bHi: number;
	a_color: number;
	a_width: number;
};

export const H = HEAT.offsets as {
	a_posHi: number;
	a_weight: number;
};
