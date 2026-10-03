/**
 * Current view of the map, in world coordinates ([0, 1] web mercator)
 */
export interface KnView {
	/** map zoom (can be fractional on vector maps) */
	readonly zoom: number;
	/** world size in CSS px (256 * 2^zoom) */
	readonly scale: number;
	/** world coordinates of the canvas center */
	readonly centerX: number;
	readonly centerY: number;
	/** canvas size in CSS px */
	readonly width: number;
	readonly height: number;
	/** device pixel ratio used by the canvas */
	readonly dpr: number;
	/** world bbox covered by the canvas (x can be outside [0, 1] when the world wraps) */
	readonly minX: number;
	readonly minY: number;
	readonly maxX: number;
	readonly maxY: number;
	/** integer world offsets to draw (copies of the world when it wraps) */
	readonly worldOffsets: readonly number[];
	/** frame time (performance.now()) */
	readonly time: number;
}

export function createView(
	zoom: number,
	centerX: number,
	centerY: number,
	width: number,
	height: number,
	dpr: number,
	time: number,
): KnView {
	const scale = 256 * 2 ** zoom;
	const halfW = width / 2 / scale;
	const halfH = height / 2 / scale;
	const minX = centerX - halfW;
	const maxX = centerX + halfW;
	const worldOffsets: number[] = [];
	for (let k = Math.floor(minX); k <= Math.floor(maxX); k++) {
		worldOffsets.push(k);
	}
	return {
		zoom,
		scale,
		centerX,
		centerY,
		width,
		height,
		dpr,
		minX,
		minY: centerY - halfH,
		maxX,
		maxY: centerY + halfH,
		worldOffsets,
		time,
	};
}

/**
 * Visible world boxes, in data coordinates ([0, 1]), for each world copy, expanded by a padding
 * (fraction of the view size)
 */
export function queryBoxes(
	view: KnView,
	padding: number,
): [
	number,
	number,
	number,
	number,
][] {
	const px = (view.maxX - view.minX) * padding;
	const py = (view.maxY - view.minY) * padding;
	const minX = view.minX - px;
	const maxX = view.maxX + px;
	const minY = Math.max(0, view.minY - py);
	const maxY = Math.min(1, view.maxY + py);

	if (maxX - minX >= 1) {
		return [
			[
				0,
				minY,
				1,
				maxY,
			],
		];
	}

	const boxes: [
		number,
		number,
		number,
		number,
	][] = [];
	for (let k = Math.floor(minX); k <= Math.floor(maxX); k++) {
		const a = Math.max(0, minX - k);
		const b = Math.min(1, maxX - k);
		if (b > a) {
			boxes.push([
				a,
				minY,
				b,
				maxY,
			]);
		}
	}
	return boxes;
}

/**
 * Screen position (CSS px relative to the canvas center) of a world point, choosing the copy of
 * the world nearest to the view center
 */
export function toScreen(
	view: KnView,
	x: number,
	y: number,
): [
	number,
	number,
] {
	let dx = x - view.centerX;
	dx -= Math.round(dx);
	return [
		dx * view.scale,
		(y - view.centerY) * view.scale,
	];
}
