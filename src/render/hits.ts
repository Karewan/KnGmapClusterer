/**
 * Clickable areas of a layer, stored in flat arrays (no object per item)
 */

import type { KnView } from "./view.ts";
import { toScreen } from "./view.ts";

const F = 6;

export class HitList {
	count = 0;
	/** per item: world x, world y, left, top, right, bottom (CSS px relative to the anchor) */
	private f = new Float64Array(64 * F);
	/** per item: kind, ref */
	private i = new Int32Array(64 * 2);

	clear(): void {
		this.count = 0;
	}

	add(
		x: number,
		y: number,
		left: number,
		top: number,
		right: number,
		bottom: number,
		kind: number,
		ref: number,
	): void {
		if (this.count * F >= this.f.length) {
			const f = new Float64Array(this.f.length * 2);
			f.set(this.f);
			this.f = f;
			const i = new Int32Array(this.i.length * 2);
			i.set(this.i);
			this.i = i;
		}
		const o = this.count * F;
		this.f[o] = x;
		this.f[o + 1] = y;
		this.f[o + 2] = left;
		this.f[o + 3] = top;
		this.f[o + 4] = right;
		this.f[o + 5] = bottom;
		this.i[this.count * 2] = kind;
		this.i[this.count * 2 + 1] = ref;
		this.count++;
	}

	/**
	 * Top-most item (last added) under a world position
	 * @returns its index, -1 if none
	 */
	find(view: KnView, wx: number, wy: number, tolerance = 0): number {
		const [px, py] = toScreen(view, wx, wy);
		for (let n = this.count - 1; n >= 0; n--) {
			const o = n * F;
			const [ax, ay] = toScreen(view, this.f[o] as number, this.f[o + 1] as number);
			const dx = px - ax;
			const dy = py - ay;
			if (
				dx >= (this.f[o + 2] as number) - tolerance &&
				dx <= (this.f[o + 4] as number) + tolerance &&
				dy >= (this.f[o + 3] as number) - tolerance &&
				dy <= (this.f[o + 5] as number) + tolerance
			) {
				return n;
			}
		}
		return -1;
	}

	kind(n: number): number {
		return this.i[n * 2] as number;
	}

	ref(n: number): number {
		return this.i[n * 2 + 1] as number;
	}

	x(n: number): number {
		return this.f[n * F] as number;
	}

	y(n: number): number {
		return this.f[n * F + 1] as number;
	}

	/**
	 * Top center of an item, in CSS px from its anchor (where an info window points to)
	 */
	top(n: number): [
		number,
		number,
	] {
		const o = n * F;
		return [
			((this.f[o + 2] as number) + (this.f[o + 4] as number)) / 2,
			this.f[o + 3] as number,
		];
	}
}
