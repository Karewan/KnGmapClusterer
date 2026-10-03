/**
 * Spiderfy layout: positions (CSS px offsets from the center) of overlapping markers
 * - a circle up to 9 markers,
 * - an Archimedean spiral beyond.
 */
export function spiderOffsets(count: number, spacing = 44): Float64Array {
	const out = new Float64Array(count * 2);

	if (count <= 9) {
		const r = Math.max(spacing * 0.8, (spacing * count) / (2 * Math.PI));
		for (let i = 0; i < count; i++) {
			const a = (2 * Math.PI * i) / count - Math.PI / 2;
			out[2 * i] = r * Math.cos(a);
			out[2 * i + 1] = r * Math.sin(a);
		}
		return out;
	}

	let angle = 0;
	let radius = spacing * 0.9;
	for (let i = 0; i < count; i++) {
		angle += spacing / radius;
		out[2 * i] = radius * Math.cos(angle);
		out[2 * i + 1] = radius * Math.sin(angle);
		// the radius grows by `spacing` on each turn
		radius += (spacing * spacing) / (2 * Math.PI * radius);
	}
	return out;
}
