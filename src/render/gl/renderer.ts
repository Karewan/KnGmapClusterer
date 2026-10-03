/**
 * WebGL2 renderer: compiles the programs and draws instance buffers.
 * One renderer per map (shared by all the layers of the map).
 */

import type { KnView } from "../view.ts";
import { Atlas } from "./atlas.ts";
import type { InstanceBuffer } from "./instances.ts";
import { CIRCLE, HEAT, type Layout, LINE, POLY, SPRITE } from "./layouts.ts";
import {
	CIRCLE_FS,
	CIRCLE_VS,
	FILL_FS,
	FILL_VS,
	HEAT_COLOR_FS,
	HEAT_COLOR_VS,
	HEAT_SPLAT_FS,
	HEAT_SPLAT_VS,
	LINE_FS,
	LINE_VS,
	SPRITE_FS,
	SPRITE_VS,
} from "./shaders.ts";

interface Program {
	readonly program: WebGLProgram;
	readonly layout: Layout;
	readonly uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
	readonly attribs: Readonly<Record<string, number>>;
}

interface GpuBuffer {
	readonly generation: number;
	readonly buffer: WebGLBuffer;
	readonly vao: WebGLVertexArrayObject;
	version: number;
	byteLength: number;
}

const UNIFORMS = [
	"u_viewport",
	"u_centerHi",
	"u_centerLo",
	"u_scale",
	"u_worldOffset",
	"u_dpr",
	"u_anim",
	"u_opacity",
	"u_atlas",
	"u_widthAdd",
	"u_colorOverride",
	"u_color",
	"u_radius",
	"u_norm",
	"u_k",
	"u_shape",
	"u_heat",
	"u_lut",
];

export interface DrawOptions {
	/** animation progress in [0, 1] (1 = done) */
	readonly anim?: number;
	readonly opacity?: number;
}

export interface LineDrawOptions extends DrawOptions {
	/** added to the width of every segment (outline pass) */
	readonly widthAdd?: number;
	/** replace the color of every segment (outline pass) */
	readonly color?:
		| readonly [
				number,
				number,
				number,
				number,
		  ]
		| null;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
	const shader = gl.createShader(type) as WebGLShader;
	gl.shaderSource(shader, source);
	gl.compileShader(shader);
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
		throw new Error(`KnGmapClusterer: shader error: ${gl.getShaderInfoLog(shader) ?? ""}`);
	}
	return shader;
}

function createProgram(
	gl: WebGL2RenderingContext,
	vs: string,
	fs: string,
	layout: Layout,
): Program {
	const program = gl.createProgram() as WebGLProgram;
	gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vs));
	gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fs));
	gl.linkProgram(program);
	if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
		throw new Error(`KnGmapClusterer: program error: ${gl.getProgramInfoLog(program) ?? ""}`);
	}

	const uniforms: Record<string, WebGLUniformLocation | null> = {};
	for (const u of UNIFORMS) {
		uniforms[u] = gl.getUniformLocation(program, u);
	}
	const attribs: Record<string, number> = {};
	for (const a of layout.attribs) {
		attribs[a.name] = gl.getAttribLocation(program, a.name);
	}
	return {
		program,
		layout,
		uniforms,
		attribs,
	};
}

export class Renderer {
	gl: WebGL2RenderingContext;
	readonly atlas: Atlas;
	/** incremented when the GL context is restored: GPU buffers must be recreated */
	generation = 0;
	private sprite!: Program;
	private circle!: Program;
	private line!: Program;
	private fill!: Program;
	private heatSplat!: Program;
	private heatColor!: Program;
	/** offscreen target of the heatmaps */
	private heatTarget: {
		readonly fb: WebGLFramebuffer;
		readonly tex: WebGLTexture;
		readonly w: number;
		readonly h: number;
	} | null = null;
	private readonly buffers = new WeakMap<InstanceBuffer, GpuBuffer>();
	private view: KnView | null = null;

	constructor(gl: WebGL2RenderingContext, dpr: number) {
		this.gl = gl;
		this.atlas = new Atlas(gl, dpr);
		this.init();
	}

	private init(): void {
		const gl = this.gl;
		this.sprite = createProgram(gl, SPRITE_VS, SPRITE_FS, SPRITE);
		this.circle = createProgram(gl, CIRCLE_VS, CIRCLE_FS, CIRCLE);
		this.line = createProgram(gl, LINE_VS, LINE_FS, LINE);
		this.fill = createProgram(gl, FILL_VS, FILL_FS, POLY);
		this.heatSplat = createProgram(gl, HEAT_SPLAT_VS, HEAT_SPLAT_FS, HEAT);
		this.heatColor = createProgram(gl, HEAT_COLOR_VS, HEAT_COLOR_FS, POLY);
		this.heatTarget = null;
	}

	/** After a WebGL context loss */
	restore(gl: WebGL2RenderingContext): void {
		this.gl = gl;
		this.generation++;
		this.init();
		this.atlas.restore(gl);
	}

	/** Start a frame */
	begin(view: KnView): void {
		const gl = this.gl;
		this.view = view;
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		gl.clearColor(0, 0, 0, 0);
		gl.clearStencil(0);
		gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
		gl.enable(gl.BLEND);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		gl.disable(gl.DEPTH_TEST);
	}

	drawSprites(buf: InstanceBuffer, opts: DrawOptions = {}): void {
		if (buf.count === 0) {
			return;
		}
		this.atlas.bind(0);
		this.draw(this.sprite, buf, opts, (p) => {
			this.gl.uniform1i(p.uniforms["u_atlas"] ?? null, 0);
		});
	}

	drawCircles(buf: InstanceBuffer, opts: DrawOptions = {}): void {
		if (buf.count === 0) {
			return;
		}
		this.atlas.bind(0);
		this.draw(this.circle, buf, opts, (p) => {
			this.gl.uniform1i(p.uniforms["u_atlas"] ?? null, 0);
		});
	}

	/**
	 * Filled polygons (any simple polygon, concave included), with the stencil buffer:
	 * a triangle fan inverts the stencil (even-odd), then a second fan colors where it is set
	 * @param buf vertices of all the polygons
	 * @param polygons first vertex, number of vertices and color (r, g, b, a in [0, 1]) of each one
	 */
	drawPolygons(
		buf: InstanceBuffer,
		polygons: readonly {
			readonly first: number;
			readonly count: number;
			readonly color: readonly [
				number,
				number,
				number,
				number,
			];
		}[],
		opts: DrawOptions = {},
	): void {
		const view = this.view;
		if (!view || buf.count === 0 || polygons.length === 0) {
			return;
		}
		const gl = this.gl;
		const p = this.fill;
		gl.useProgram(p.program);
		this.bindBuffer(p, buf);
		this.setViewUniforms(p, view, opts);
		gl.enable(gl.STENCIL_TEST);
		for (const offset of view.worldOffsets) {
			gl.uniform1f(p.uniforms["u_worldOffset"] ?? null, offset);
			for (const poly of polygons) {
				if (poly.count < 3) {
					continue;
				}
				gl.colorMask(false, false, false, false);
				gl.stencilFunc(gl.ALWAYS, 0, 0xff);
				gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
				gl.drawArrays(gl.TRIANGLE_FAN, poly.first, poly.count);

				gl.colorMask(true, true, true, true);
				gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
				gl.stencilOp(gl.ZERO, gl.ZERO, gl.ZERO);
				const c = poly.color;
				gl.uniform4f(p.uniforms["u_color"] ?? null, c[0], c[1], c[2], c[3]);
				gl.drawArrays(gl.TRIANGLE_FAN, poly.first, poly.count);
			}
		}
		gl.disable(gl.STENCIL_TEST);
		gl.bindVertexArray(null);
	}

	/**
	 * Color gradient texture (256 x 1) of a heatmap
	 * @param stops CSS colors, from the lowest to the highest density
	 */
	createGradient(stops: readonly string[]): WebGLTexture {
		const canvas = document.createElement("canvas");
		canvas.width = 256;
		canvas.height = 1;
		const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
		const g = ctx.createLinearGradient(0, 0, 256, 0);
		stops.forEach((c, i) => {
			g.addColorStop(stops.length > 1 ? i / (stops.length - 1) : 0, c);
		});
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, 256, 1);

		const gl = this.gl;
		const tex = gl.createTexture() as WebGLTexture;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
		gl.texImage2D(
			gl.TEXTURE_2D,
			0,
			gl.RGBA,
			256,
			1,
			0,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			ctx.getImageData(0, 0, 256, 1),
		);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return tex;
	}

	/** Free a texture created by the renderer */
	deleteTexture(tex: WebGLTexture): void {
		this.gl.deleteTexture(tex);
	}

	/** Float (or 8 bits) offscreen target of the size of the canvas */
	private getHeatTarget(): NonNullable<Renderer["heatTarget"]> {
		const gl = this.gl;
		const w = gl.drawingBufferWidth;
		const h = gl.drawingBufferHeight;
		if (this.heatTarget && this.heatTarget.w === w && this.heatTarget.h === h) {
			return this.heatTarget;
		}
		if (this.heatTarget) {
			gl.deleteFramebuffer(this.heatTarget.fb);
			gl.deleteTexture(this.heatTarget.tex);
		}
		// half floats: no saturation, no banding (8 bits fallback without the extension)
		const float = gl.getExtension("EXT_color_buffer_float") !== null;
		const tex = gl.createTexture() as WebGLTexture;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texStorage2D(gl.TEXTURE_2D, 1, float ? gl.R16F : gl.RGBA8, w, h);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
		const fb = gl.createFramebuffer() as WebGLFramebuffer;
		gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		this.heatTarget = {
			fb,
			tex,
			w,
			h,
		};
		return this.heatTarget;
	}

	/**
	 * Heatmap: the splats are summed in an offscreen texture, then colored with the gradient
	 * @param radius splat radius in CSS px
	 * @param norm 1 / max density (the gradient covers [0, max])
	 */
	drawHeatmap(
		buf: InstanceBuffer,
		gradient: WebGLTexture,
		radius: number,
		norm: number,
		k: number,
		opacity: number,
		max = false,
	): void {
		const view = this.view;
		if (!view || buf.count === 0) {
			return;
		}
		const gl = this.gl;
		const target = this.getHeatTarget();

		// 1. sum (or max) of the splats
		gl.bindFramebuffer(gl.FRAMEBUFFER, target.fb);
		gl.viewport(0, 0, target.w, target.h);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);
		gl.blendFunc(gl.ONE, gl.ONE);
		if (max) {
			gl.blendEquation(gl.MAX);
		}
		this.draw(this.heatSplat, buf, {}, (p) => {
			gl.uniform1f(p.uniforms["u_radius"] ?? null, radius);
			gl.uniform1f(p.uniforms["u_norm"] ?? null, norm);
			gl.uniform1f(p.uniforms["u_k"] ?? null, k);
			// max: flatter kernel, a point keeps its value over most of its radius
			gl.uniform1f(p.uniforms["u_shape"] ?? null, max ? 1.5 : 1);
		});
		gl.blendEquation(gl.FUNC_ADD);

		// 2. colors
		gl.bindFramebuffer(gl.FRAMEBUFFER, null);
		gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
		gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
		const p = this.heatColor;
		gl.useProgram(p.program);
		gl.bindVertexArray(null);
		gl.activeTexture(gl.TEXTURE2);
		gl.bindTexture(gl.TEXTURE_2D, target.tex);
		gl.activeTexture(gl.TEXTURE3);
		gl.bindTexture(gl.TEXTURE_2D, gradient);
		gl.uniform1i(p.uniforms["u_heat"] ?? null, 2);
		gl.uniform1i(p.uniforms["u_lut"] ?? null, 3);
		gl.uniform1f(p.uniforms["u_opacity"] ?? null, opacity);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
	}

	drawLines(buf: InstanceBuffer, opts: LineDrawOptions = {}): void {
		this.draw(this.line, buf, opts, (p) => {
			const gl = this.gl;
			gl.uniform1f(p.uniforms["u_widthAdd"] ?? null, opts.widthAdd ?? 0);
			const c = opts.color ?? [
				0,
				0,
				0,
				0,
			];
			gl.uniform4f(p.uniforms["u_colorOverride"] ?? null, c[0], c[1], c[2], c[3]);
		});
	}

	/** Uniforms of the view (projection) */
	private setViewUniforms(p: Program, view: KnView, opts: DrawOptions): void {
		const gl = this.gl;
		const u = p.uniforms;
		const cxHi = Math.fround(view.centerX);
		const cyHi = Math.fround(view.centerY);
		gl.uniform2f(u["u_viewport"] ?? null, view.width, view.height);
		gl.uniform2f(u["u_centerHi"] ?? null, cxHi, cyHi);
		gl.uniform2f(u["u_centerLo"] ?? null, view.centerX - cxHi, view.centerY - cyHi);
		gl.uniform1f(u["u_scale"] ?? null, view.scale);
		gl.uniform1f(u["u_dpr"] ?? null, view.dpr);
		gl.uniform1f(u["u_anim"] ?? null, opts.anim ?? 1);
		gl.uniform1f(u["u_opacity"] ?? null, opts.opacity ?? 1);
	}

	private draw(
		p: Program,
		buf: InstanceBuffer,
		opts: DrawOptions,
		setup?: (p: Program) => void,
	): void {
		const view = this.view;
		if (!view || buf.count === 0) {
			return;
		}

		const gl = this.gl;
		gl.useProgram(p.program);
		this.bindBuffer(p, buf);

		const u = p.uniforms;
		this.setViewUniforms(p, view, opts);
		setup?.(p);

		for (const offset of view.worldOffsets) {
			gl.uniform1f(u["u_worldOffset"] ?? null, offset);
			gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, buf.count);
		}
		gl.bindVertexArray(null);
	}

	private bindBuffer(p: Program, buf: InstanceBuffer): void {
		const gl = this.gl;
		let gpu = this.buffers.get(buf);

		if (!gpu || gpu.generation !== this.generation) {
			const buffer = gl.createBuffer() as WebGLBuffer;
			const vao = gl.createVertexArray() as WebGLVertexArrayObject;
			gl.bindVertexArray(vao);
			gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

			const stride = p.layout.stride * 4;
			let offset = 0;
			for (const a of p.layout.attribs) {
				const loc = p.attribs[a.name] ?? -1;
				if (loc >= 0) {
					gl.enableVertexAttribArray(loc);
					if (a.type === "c") {
						gl.vertexAttribPointer(loc, 4, gl.UNSIGNED_BYTE, true, stride, offset);
					} else {
						gl.vertexAttribPointer(loc, a.size, gl.FLOAT, false, stride, offset);
					}
					gl.vertexAttribDivisor(loc, p.layout.perVertex ? 0 : 1);
				}
				offset += (a.type === "c" ? 1 : a.size) * 4;
			}

			gpu = {
				generation: this.generation,
				buffer,
				vao,
				version: -1,
				byteLength: 0,
			};
			this.buffers.set(buf, gpu);
		} else {
			gl.bindVertexArray(gpu.vao);
			gl.bindBuffer(gl.ARRAY_BUFFER, gpu.buffer);
		}

		if (gpu.version !== buf.version) {
			const bytes = buf.count * buf.layout.stride * 4;
			const data = new Uint8Array(buf.f32.buffer, 0, bytes);
			if (bytes > gpu.byteLength) {
				gl.bufferData(gl.ARRAY_BUFFER, buf.f32.byteLength, gl.DYNAMIC_DRAW);
				gpu.byteLength = buf.f32.byteLength;
			}
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
			gpu.version = buf.version;
		}
	}

	/** Free the GPU resources of a buffer */
	release(buf: InstanceBuffer): void {
		const gpu = this.buffers.get(buf);
		if (gpu && gpu.generation === this.generation) {
			this.gl.deleteBuffer(gpu.buffer);
			this.gl.deleteVertexArray(gpu.vao);
		}
		this.buffers.delete(buf);
	}
}
