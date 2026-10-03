import type { Layout } from "./layouts.ts";

/**
 * Growable CPU side buffer of instances (uploaded to the GPU by the renderer)
 */
export class InstanceBuffer {
	readonly layout: Layout;
	/** number of instances */
	count = 0;
	/** incremented on every change, the renderer re-uploads when it changes */
	version = 0;
	f32: Float32Array;
	u32: Uint32Array;

	constructor(layout: Layout, capacity = 64) {
		this.layout = layout;
		const buffer = new ArrayBuffer(capacity * layout.stride * 4);
		this.f32 = new Float32Array(buffer);
		this.u32 = new Uint32Array(buffer);
	}

	get capacity(): number {
		return this.f32.length / this.layout.stride;
	}

	clear(): void {
		this.count = 0;
		this.version++;
	}

	/**
	 * Append an instance (zero filled)
	 * @returns its offset (in 4 bytes slots) in f32 / u32
	 */
	push(): number {
		if (this.count >= this.capacity) {
			this.grow(this.count * 2);
		}
		const o = this.count * this.layout.stride;
		this.f32.fill(0, o, o + this.layout.stride);
		this.count++;
		this.version++;
		return o;
	}

	/** Reserve room for n more instances */
	reserve(n: number): void {
		if (this.count + n > this.capacity) {
			this.grow(this.count + n);
		}
	}

	private grow(min: number): void {
		const capacity = Math.max(64, min, this.capacity * 2);
		const buffer = new ArrayBuffer(capacity * this.layout.stride * 4);
		const f32 = new Float32Array(buffer);
		f32.set(this.f32.subarray(0, this.count * this.layout.stride));
		this.f32 = f32;
		this.u32 = new Uint32Array(buffer);
	}
}

/**
 * Write a world position as two float32 (high part + low part) to keep a double precision
 * on the GPU: at zoom 20 the world is 2^28 px wide, way beyond float32 precision.
 */
export function writePos(f32: Float32Array, o: number, x: number, y: number): void {
	const hx = Math.fround(x);
	const hy = Math.fround(y);
	f32[o] = hx;
	f32[o + 1] = hy;
	f32[o + 2] = x - hx;
	f32[o + 3] = y - hy;
}
