/**
 * Texture atlas (icons, texts, arrows), rasterized at the device pixel ratio.
 * Shelf packing; when full the atlas is reset (generation++) and the layers rebuild their instances.
 */

export interface AtlasEntry {
	readonly u0: number;
	readonly v0: number;
	readonly u1: number;
	readonly v1: number;
	/** size in CSS px */
	readonly width: number;
	readonly height: number;
	/** anchor point in CSS px from the top left corner */
	readonly anchorX: number;
	readonly anchorY: number;
	/** label center in CSS px from the top left corner */
	readonly labelX: number;
	readonly labelY: number;
}

export interface EntryGeometry {
	readonly width: number;
	readonly height: number;
	readonly anchorX: number;
	readonly anchorY: number;
	readonly labelX: number;
	readonly labelY: number;
}

export type Painter = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

const SIZE = 2048;
const PAD = 1;

export class Atlas {
	/** incremented on every reset: instances referencing the atlas must be rebuilt */
	generation = 0;
	dpr: number;
	private gl: WebGL2RenderingContext;
	private texture: WebGLTexture | null = null;
	private readonly entries = new Map<string, AtlasEntry>();
	private shelfX = 0;
	private shelfY = 0;
	private shelfH = 0;
	private scratch: HTMLCanvasElement | null = null;
	private scratchCtx: CanvasRenderingContext2D | null = null;
	private opaque: HTMLCanvasElement | null = null;
	private opaqueCtx: CanvasRenderingContext2D | null = null;

	constructor(gl: WebGL2RenderingContext, dpr: number) {
		this.gl = gl;
		this.dpr = dpr;
		this.createTexture();
	}

	private createTexture(): void {
		const gl = this.gl;
		this.texture = gl.createTexture();
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, SIZE, SIZE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}

	/** Bind the atlas texture on a texture unit */
	bind(unit: number): void {
		const gl = this.gl;
		gl.activeTexture(gl.TEXTURE0 + unit);
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
	}

	/** Forget every entry (and optionally change the pixel ratio) */
	reset(dpr: number = this.dpr): void {
		this.entries.clear();
		this.shelfX = 0;
		this.shelfY = 0;
		this.shelfH = 0;
		this.dpr = dpr;
		this.generation++;
	}

	/** After a WebGL context loss */
	restore(gl: WebGL2RenderingContext): void {
		this.gl = gl;
		this.createTexture();
		this.reset();
	}

	get(key: string): AtlasEntry | undefined {
		return this.entries.get(key);
	}

	/**
	 * Rasterize a new entry
	 * @param painter draws in CSS px (the context is already scaled by the pixel ratio)
	 * @param opaque paint on an opaque canvas: enables the sub-pixel (LCD) anti-aliasing of the
	 * texts, the painter must fill the whole entry
	 */
	add(key: string, geometry: EntryGeometry, painter: Painter, opaque = false): AtlasEntry {
		const existing = this.entries.get(key);
		if (existing) {
			return existing;
		}

		const dpr = this.dpr;
		const pw = Math.min(Math.ceil(geometry.width * dpr), SIZE - 2 * PAD);
		const ph = Math.min(Math.ceil(geometry.height * dpr), SIZE - 2 * PAD);
		let pos = this.allocate(pw + 2 * PAD, ph + 2 * PAD);
		if (!pos) {
			this.reset();
			pos = this.allocate(pw + 2 * PAD, ph + 2 * PAD) ?? [
				0,
				0,
			];
		}
		const [x, y] = pos;

		const canvas = this.getScratch(pw, ph, opaque);
		const ctx = (opaque ? this.opaqueCtx : this.scratchCtx) as CanvasRenderingContext2D;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		painter(ctx, geometry.width, geometry.height);

		const gl = this.gl;
		gl.bindTexture(gl.TEXTURE_2D, this.texture);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
		const data = ctx.getImageData(0, 0, pw, ph);
		gl.texSubImage2D(
			gl.TEXTURE_2D,
			0,
			x + PAD,
			y + PAD,
			pw,
			ph,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			data,
		);

		const entry: AtlasEntry = {
			u0: (x + PAD) / SIZE,
			v0: (y + PAD) / SIZE,
			u1: (x + PAD + pw) / SIZE,
			v1: (y + PAD + ph) / SIZE,
			...geometry,
			// exact size of the rasterized pixels: one texel per device pixel, no resampling (sharp)
			width: pw / dpr,
			height: ph / dpr,
		};
		this.entries.set(key, entry);
		return entry;
	}

	private allocate(
		w: number,
		h: number,
	):
		| [
				number,
				number,
		  ]
		| null {
		if (this.shelfX + w > SIZE) {
			this.shelfY += this.shelfH;
			this.shelfX = 0;
			this.shelfH = 0;
		}
		if (this.shelfY + h > SIZE) {
			return null;
		}
		const pos: [
			number,
			number,
		] = [
			this.shelfX,
			this.shelfY,
		];
		this.shelfX += w;
		this.shelfH = Math.max(this.shelfH, h);
		return pos;
	}

	private getScratch(w: number, h: number, opaque = false): HTMLCanvasElement {
		if (opaque && !this.opaque) {
			this.opaque = document.createElement("canvas");
			this.opaqueCtx = this.opaque.getContext("2d", {
				alpha: false,
				willReadFrequently: true,
			});
		}
		if (!opaque && !this.scratch) {
			this.scratch = document.createElement("canvas");
			this.scratchCtx = this.scratch.getContext("2d", {
				willReadFrequently: true,
			});
		}
		const c = (opaque ? this.opaque : this.scratch) as HTMLCanvasElement;
		if (c.width < w || c.height < h) {
			c.width = Math.max(c.width, w, 64);
			c.height = Math.max(c.height, h, 64);
		}
		return c;
	}

	/** Context used to measure texts */
	measureContext(): CanvasRenderingContext2D {
		this.getScratch(64, 64);
		return this.scratchCtx as CanvasRenderingContext2D;
	}
}
