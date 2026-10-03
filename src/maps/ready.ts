/**
 * Run a callback once the map is ready to compute a viewport (fitBounds...):
 * projection available and container measured. A map created on a detached element (KnMaps)
 * is only measured after being added to the page.
 */
export function whenMapReady(map: google.maps.Map, cb: () => void, tries = 20): void {
	const div = map.getDiv();
	if (map.getProjection() && div.clientWidth > 0 && div.clientHeight > 0) {
		cb();
		return;
	}
	if (tries <= 0) {
		cb();
		return;
	}
	google.maps.event.addListenerOnce(map, "idle", () => whenMapReady(map, cb, tries - 1));
}

const viewportTokens = new WeakMap<google.maps.Map, number>();

/**
 * Change the viewport (fitBounds...) once the map is ready. Only the last change requested on a map
 * runs: a fit waiting for the map can not override a more recent one.
 */
export function whenMapReadyForViewport(map: google.maps.Map, cb: () => void): void {
	const token = (viewportTokens.get(map) ?? 0) + 1;
	viewportTokens.set(map, token);
	whenMapReady(map, () => {
		if (viewportTokens.get(map) === token) {
			cb();
		}
	});
}
