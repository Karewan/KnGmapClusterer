/**
 * GLSL ES 3.00 shaders.
 *
 * Positions are world coordinates ([0, 1] web mercator) split in high/low float32 parts,
 * projected relatively to the view center to keep the precision at high zoom levels.
 * All the sizes are in CSS pixels.
 */

const COMMON = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 u_viewport;
uniform vec2 u_centerHi;
uniform vec2 u_centerLo;
uniform float u_scale;
uniform float u_worldOffset;
uniform float u_dpr;
uniform float u_anim;
uniform float u_opacity;

// world position => CSS px relative to the canvas center
vec2 project(vec2 hi, vec2 lo) {
	vec2 d = (hi - u_centerHi) + (lo - u_centerLo);
	d.x += u_worldOffset;
	return d * u_scale;
}

// snap a point to the device pixel grid (crisp icons)
vec2 snap(vec2 px) {
	vec2 half_ = u_viewport * 0.5;
	return floor((px + half_) * u_dpr + 0.5) / u_dpr - half_;
}

vec4 toClip(vec2 px) {
	vec2 c = px / (u_viewport * 0.5);
	return vec4(c.x, -c.y, 0.0, 1.0);
}

vec4 premultiply(vec4 c) {
	return vec4(c.rgb * c.a, c.a);
}

float easeOut(float t) {
	float e = 1.0 - t;
	return 1.0 - e * e * e;
}
`;

export const SPRITE_VS: string = /* glsl */ `${COMMON}
in vec2 a_posHi;
in vec2 a_posLo;
in vec2 a_offset;
in vec2 a_size;
in vec4 a_uv;
in vec4 a_color;
in float a_rotation;
in vec3 a_anim;
in float a_corner;

out vec2 v_uv;
out vec4 v_color;
out vec2 v_local;
flat out vec2 v_size;
flat out float v_corner;

void main() {
	vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
	v_local = corner * a_size;
	v_size = a_size;
	v_corner = a_corner;
	float t = easeOut(u_anim);
	vec2 anchor = project(a_posHi, a_posLo) + a_anim.xy * u_scale * (1.0 - t);

	vec2 pos;
	if (a_rotation == 0.0) {
		// sharp: the top left corner on a device pixel, and a_size is a whole number of device
		// pixels (atlas entries), so each texel maps exactly one pixel
		pos = snap(anchor + a_offset) + corner * a_size;
	} else {
		vec2 p = a_offset + corner * a_size;
		float c = cos(a_rotation);
		float s = sin(a_rotation);
		pos = anchor + vec2(p.x * c - p.y * s, p.x * s + p.y * c);
	}

	gl_Position = toClip(pos);
	v_uv = mix(a_uv.xy, a_uv.zw, corner);
	float alpha = a_anim.z > 0.5 ? t : 1.0;
	v_color = premultiply(a_color) * alpha * u_opacity;
}
`;

export const SPRITE_FS: string = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_atlas;
in vec2 v_uv;
in vec4 v_color;
in vec2 v_local;
flat in vec2 v_size;
flat in float v_corner;
out vec4 o_color;
void main() {
	o_color = texture(u_atlas, v_uv) * v_color;
	if (v_corner > 0.0) {
		// rounded rectangle (signed distance, one device pixel anti-aliasing)
		vec2 h = v_size * 0.5;
		vec2 q = abs(v_local - h) - (h - v_corner);
		float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - v_corner;
		o_color *= clamp(0.5 - d / max(fwidth(d), 1e-3), 0.0, 1.0);
	}
}
`;

export const CIRCLE_VS: string = /* glsl */ `${COMMON}
in vec2 a_posHi;
in vec2 a_posLo;
in vec2 a_offset;
in float a_radius;
in float a_strokeWidth;
in vec4 a_fill;
in vec4 a_stroke;
in vec3 a_anim;
in vec4 a_stops;
in vec4 a_c0;
in vec4 a_c1;
in vec4 a_c2;
in vec4 a_c3;
in vec4 a_textUv;
in vec2 a_textSize;

out vec2 v_p;
flat out vec4 v_textUv;
flat out vec2 v_textHalf;
flat out float v_radius;
flat out float v_strokeWidth;
flat out float v_alpha;
flat out vec4 v_fill;
flat out vec4 v_stroke;
flat out vec4 v_stops;
flat out vec4 v_c0;
flat out vec4 v_c1;
flat out vec4 v_c2;
flat out vec4 v_c3;

void main() {
	vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
	float t = easeOut(u_anim);
	float grow = a_anim.z > 0.5 ? mix(0.6, 1.0, t) : 1.0;
	float r = a_radius * grow;
	float ext = r + 1.5;

	vec2 anchor = project(a_posHi, a_posLo) + a_anim.xy * u_scale * (1.0 - t) + a_offset;
	// the text texture must map 1 texel = 1 device pixel: its top left corner on the pixel grid
	vec2 half_ = a_textSize * 0.5;
	anchor = snap(anchor - half_) + half_;
	gl_Position = toClip(anchor + corner * ext);

	v_p = corner * ext;
	v_textUv = a_textUv;
	v_textHalf = half_;
	v_radius = r;
	v_strokeWidth = a_strokeWidth * grow;
	v_alpha = (a_anim.z > 0.5 ? t : 1.0) * u_opacity;
	v_fill = a_fill;
	v_stroke = a_stroke;
	v_stops = a_stops;
	v_c0 = a_c0;
	v_c1 = a_c1;
	v_c2 = a_c2;
	v_c3 = a_c3;
}
`;

export const CIRCLE_FS: string = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_p;
flat in float v_radius;
flat in float v_strokeWidth;
flat in float v_alpha;
flat in vec4 v_fill;
flat in vec4 v_stroke;
flat in vec4 v_stops;
flat in vec4 v_c0;
flat in vec4 v_c1;
flat in vec4 v_c2;
flat in vec4 v_c3;
flat in vec4 v_textUv;
flat in vec2 v_textHalf;
uniform sampler2D u_atlas;
out vec4 o_color;

const float TAU = 6.28318530718;

void main() {
	float d = length(v_p);
	// exact pixel coverage: linear ramp of one device pixel centered on the edge
	float aa = max(fwidth(d), 1e-3);
	float coverage = clamp((v_radius - d) / aa + 0.5, 0.0, 1.0);
	if (coverage <= 0.0) {
		discard;
	}

	vec4 ring = v_stroke;
	if (v_stops.w > 0.0) {
		// donut: angle from the top, clockwise, in [0, 1)
		float a = fract(atan(v_p.x, -v_p.y) / TAU + 1.0);
		ring = a < v_stops.x ? v_c0 : a < v_stops.y ? v_c1 : a < v_stops.z ? v_c2 : v_c3;
	}

	float inner = v_radius - v_strokeWidth;
	vec4 fill = v_fill;

	// text rasterized over the fill color (opaque, sub-pixel anti-aliased)
	if (v_textHalf.x > 0.0 && abs(v_p.x) < v_textHalf.x && abs(v_p.y) < v_textHalf.y) {
		vec2 t = (v_p + v_textHalf) / (2.0 * v_textHalf);
		vec4 text = texture(u_atlas, mix(v_textUv.xy, v_textUv.zw, t));
		fill = vec4(text.rgb, v_fill.a);
	}

	vec4 color = fill;
	if (v_strokeWidth > 0.0) {
		color = mix(fill, ring, clamp((d - inner) / aa + 0.5, 0.0, 1.0));
	}

	o_color = vec4(color.rgb * color.a, color.a) * coverage * v_alpha;
}
`;

export const LINE_VS: string = /* glsl */ `${COMMON}
in vec2 a_aHi;
in vec2 a_aLo;
in vec2 a_bHi;
in vec2 a_bLo;
in vec4 a_color;
in float a_width;

uniform float u_widthAdd;
uniform vec4 u_colorOverride;

out vec2 v_local;
flat out float v_len;
flat out float v_halfWidth;
flat out vec4 v_color;

void main() {
	vec2 pa = project(a_aHi, a_aLo);
	vec2 pb = project(a_bHi, a_bLo);
	vec2 d = pb - pa;
	float len = length(d);
	vec2 dir = len > 1e-6 ? d / len : vec2(1.0, 0.0);
	vec2 nrm = vec2(-dir.y, dir.x);

	float hw = (a_width + u_widthAdd) * 0.5;
	float ext = hw + 1.0;
	vec2 corner = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
	float along = mix(-ext, len + ext, corner.x);
	float across = mix(-ext, ext, corner.y);

	gl_Position = toClip(pa + dir * along + nrm * across);
	v_local = vec2(along, across);
	v_len = len;
	v_halfWidth = hw;
	vec4 c = u_colorOverride.a > 0.0 ? u_colorOverride : a_color;
	v_color = premultiply(c) * u_opacity;
}
`;

export const LINE_FS: string = /* glsl */ `#version 300 es
precision highp float;
in vec2 v_local;
flat in float v_len;
flat in float v_halfWidth;
flat in vec4 v_color;
out vec4 o_color;
void main() {
	float dx = max(max(-v_local.x, v_local.x - v_len), 0.0);
	float dist = length(vec2(dx, v_local.y));
	// exact pixel coverage (one device pixel ramp)
	float a = clamp((v_halfWidth - dist) / max(fwidth(dist), 1e-3) + 0.5, 0.0, 1.0);
	if (a <= 0.0) {
		discard;
	}
	o_color = v_color * a;
}
`;

export const FILL_VS: string = /* glsl */ `${COMMON}
in vec2 a_posHi;
in vec2 a_posLo;
void main() {
	gl_Position = toClip(project(a_posHi, a_posLo));
}
`;

export const FILL_FS: string = /* glsl */ `#version 300 es
precision mediump float;
uniform vec4 u_color;
out vec4 o_color;
void main() {
	o_color = vec4(u_color.rgb * u_color.a, u_color.a);
}
`;

export const HEAT_SPLAT_VS: string = /* glsl */ `${COMMON}
in vec2 a_posHi;
in vec2 a_posLo;
in float a_weight;
uniform float u_radius;
out vec2 v_local;
flat out float v_weight;
void main() {
	vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
	gl_Position = toClip(project(a_posHi, a_posLo) + c * u_radius);
	v_local = c;
	v_weight = a_weight;
}
`;

export const HEAT_SPLAT_FS: string = /* glsl */ `#version 300 es
precision highp float;
uniform float u_norm;
uniform float u_k;
uniform float u_shape;
in vec2 v_local;
flat in float v_weight;
out vec4 o_color;
void main() {
	float d2 = dot(v_local, v_local);
	if (d2 > 1.0) {
		discard;
	}
	// additive blending: the sum of the kernels (or MAX blending: the strongest), normalized
	o_color = vec4(v_weight * exp(-u_k * pow(d2, u_shape)) * u_norm, 0.0, 0.0, 0.0);
}
`;

export const HEAT_COLOR_VS: string = /* glsl */ `#version 300 es
void main() {
	vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1)) * 2.0 - 1.0;
	gl_Position = vec4(c, 0.0, 1.0);
}
`;

export const HEAT_COLOR_FS: string = /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D u_heat;
uniform sampler2D u_lut;
uniform float u_opacity;
out vec4 o_color;
void main() {
	float v = texelFetch(u_heat, ivec2(gl_FragCoord.xy), 0).r;
	if (v <= 0.0) {
		discard;
	}
	float t = clamp(v, 0.0, 1.0);
	vec4 c = texture(u_lut, vec2(t * (255.0 / 256.0) + 0.5 / 256.0, 0.5));
	float a = c.a * u_opacity;
	o_color = vec4(c.rgb * a, a);
}
`;
