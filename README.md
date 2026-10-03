# KnGmapClusterer

Ultra fast WebGL2 marker clusterer, routes and map manager for Google Maps.

- **Fast**: clustering 30 to 40% faster than supercluster 9, index built in a Web Worker,
  everything drawn with WebGL2 (one draw call per layer): 200k+ markers stay fluid.
- **Raster maps**: no `mapId`, no vector map needed, JSON `styles` keep working.
- **Simple API**: `new KnGmapClusterer(map).load(points)`, points are `{ x: lng, y: lat, ...yours }`.
- **Features**: dynamic cluster style (closure), aggregates (sum, min, max, avg, countBy), donut
  clusters, pinned markers, duplicates (spiderfy or browsed in the info window), CSS styled info
  windows, SVG icons builder, zones (smooth perimeter of groups instead of clusters), routes with
  direction arrows and statistics, map instances manager, OSM / IGN tile layers, themes, static
  maps, Vue 3 components.
- **TypeScript**: strict types everywhere, zero runtime dependency.

## Install

```bash
pnpm add kn-gmap-clusterer
```

Or without bundler (global `KnGmapClusterer`):

```html
<script src="https://cdn.jsdelivr.net/npm/kn-gmap-clusterer@5/dist/kn-gmap-clusterer.umd.js"></script>
```

## Quick start

```ts
import { KnGmapClusterer, KnMaps } from "kn-gmap-clusterer";

KnMaps.configure({ apiKey: "YOUR_KEY", language: "fr" });
const { el, map } = await KnMaps.get("main");
document.querySelector("#map")!.append(el);

const clusterer = new KnGmapClusterer(map, {
	infoWindow: (e) => `<b>${e.point.name}</b>`,
});
await clusterer.load([{ x: 2.35, y: 48.85, name: "Paris" } /* ... */]);
```

You can also use your own `google.maps.Map`: the layers only need a map instance.

## Clusterer

```ts
type Site = { x: number; y: number; id: number; type: "alarm" | "ok"; value: number };

const aggregate = { types: { countBy: "type" }, total: { sum: "value" } } as const;

const clusterer = new KnGmapClusterer<Site, typeof aggregate>(map, {
	radius: 60, // cluster radius in px (default 60)
	maxZoom: 16, // max zoom to cluster on (default 16)
	minPoints: 2, // min points to form a cluster (default 2)
	aggregate, // computed on every cluster (in the worker)
	cluster: {
		// dynamic style: color, size, border, text, font, icon
		style: (c) => ({ color: c.agg.types["alarm"] ? "#d93025" : "#1e8e3e" }),
		// or a donut from a countBy aggregate
		// donut: { aggregate: "types", colors: { alarm: "#d93025", ok: "#1e8e3e" } },
	},
	marker: {
		icon: (p) => (p.type === "alarm" ? "/icons/alarm.svg" : { pin: "#1e8e3e" }),
		label: (p) => p.id,
	},
	pinned: (p) => p.type === "alarm", // never clustered, always visible
	duplicates: "info", // same position: 'spiderfy' | 'info' (previous / next) | 'merge' | 'none'
	onMarkerClick: (e) => console.log(e.point, e.duplicates),
	onClusterClick: "zoom", // 'zoom' | false | (e) => ...
	infoWindow: (e) => `<b>#${e.point.id}</b>`,
});

await clusterer.load(points); // fits the map to the points, load(points, { fit: false }) to disable
clusterer.setFilter((p) => p.value > 10);
clusterer.setOptions({ radius: 80 });
clusterer.getVisible(); // clusters and points currently drawn
clusterer.getLeaves(clusterId, 100);
clusterer.destroy();
```

`cluster: false` disables the clustering: every point is drawn (200k points stay fluid).

### A few markers

```ts
const markers = new KnGmapClusterer<Place>(map, { cluster: false });
await markers.load([{ x: 2.2945, y: 48.8584, name: "Eiffel Tower" }]); // one marker
await markers.add(place1, place2); // add some
await markers.remove(place1); // or a predicate: remove((p) => p.temporary)
vehicle.x = 2.35; // move a loaded point in place...
await markers.refresh(); // ...then redraw it
```

`add()` and `remove()` rebuild the index: fine for a few points at a time, use `load()` to replace
many of them.

### Info window

One info window per map, shared by the layers: a click on the map (empty place or another marker)
closes it. It is a plain HTML element styled with CSS:

```css
.kn-info {
	--kn-info-bg: #202124;
	--kn-info-color: #e8eaed;
	--kn-info-radius: 12px;
	--kn-info-max-width: 280px;
}
.kn-info__nav { /* previous / next of the duplicates */ }
```

Variables: `--kn-info-bg`, `--kn-info-color`, `--kn-info-radius`, `--kn-info-shadow`,
`--kn-info-padding`, `--kn-info-font`, `--kn-info-border`, `--kn-info-hover`,
`--kn-info-max-height`. Per layer: `infoWindowOptions: { className, maxWidth, closeButton, autoPan }`.
`clusterer.openInfoWindow(content, position, offset?)` / `closeInfoWindow()` open it by code.

### Icons

An icon (`KnIcon`) is one of:

- a URL (PNG, SVG, data URI) or a raw `<svg>` string,
- `{ url, size: [w, h], anchor: [x, y], labelOrigin: [x, y] }`,
- `{ pin: color, size?, stroke?, dot? }`: built-in pin, no request,
- `{ circle: color, radius?, stroke?, strokeWidth? }`: built-in circle, no request.

SVG builder: `knSvg.pin({ color, glyph: "car" })`, `knSvg.badge({ color, glyph: "person", shape: "square" })`
(glyphs: car, truck, alert, home, flag, star, bolt, person, check, or any 24 x 24 SVG path). Each
distinct icon is rasterized once: 200k SVG markers are drawn as fast as plain circles.

Sharpness: circles are computed per pixel in the shaders (exact one pixel anti-aliasing), icons
and texts are rasterized at the screen pixel ratio and drawn pixel aligned (one texel per device
pixel), cluster counts are rasterized over the cluster color to get the sub-pixel (ClearType)
anti-aliasing of the system texts.

## Routes

```ts
import { KnRouteLayer } from "kn-gmap-clusterer";

const route = new KnRouteLayer<TrackPoint>(map, {
	color: (a, b) => speedColor(a.speed), // or a single color
	width: 6,
	arrows: { spacing: 70 }, // direction arrows (size, color, outline), false to disable
	points: { minZoom: 15 }, // intermediate points visible from zoom 15
	pinned: (p, i, all) => i === 0 || i === all.length - 1 || p.event != null,
	time: (p) => p.date, // enables durations and speeds
	speed: (p) => p.speed, // GPS speed (km/h) for the max speed
	infoWindow: (e) => `${e.point.speed} km/h`,
});
await route.load(track);

route.getStats();
// { distance (m), duration, movingDuration (ms), averageSpeed, averageMovingSpeed, maxSpeed (km/h), start, end }
```

The line is simplified (Douglas-Peucker) for each zoom, precomputed once in the worker.

## Zones

Instead of clusters, the exact outer perimeter of groups of points: each point has a group (and
optionally a group label). The outline is the concave hull of the group: it passes through the
outermost points, no margin, no approximation (transparent fill, opaque border), with the label and
the number of points in the middle. A click on a zone shows its markers, a
click outside, on another zone or on the close button closes it.

```ts
import { KnZoneLayer } from "kn-gmap-clusterer";

const zones = new KnZoneLayer<Site>(map, {
	group: (p) => p.depotId, // default: p.group
	groupLabel: (p) => p.depotName, // default: p.groupLabel
	color: (zone) => (zone.count > 100 ? "#d93025" : "#1a73e8"), // default: palette
	fillOpacity: 0.15,
	strokeWidth: 2.5,
	concavity: 2, // 1 = follows the points very closely, Infinity = convex hull
	cluster: true, // cluster the markers of the opened zone (or clusterer options), default false
	marker: { icon: (p) => knSvg.pin({ color: "#1a73e8", glyph: "home" }) },
	infoWindow: (e) => `<b>${e.point.name}</b>`,
	onZoneOpen: (zone) => {},
});
await zones.load(points);
zones.open("north"); // or null / zones.close()
zones.getZones(); // [{ key, label, count, x, y, color, points }]
```

The hulls are computed in the worker (concaveman algorithm: 20k points in about 40 ms), filled by
the GPU with the stencil buffer (exact polygon, concave included) and outlined with anti-aliased
segments. The label is placed at the pole of inaccessibility (inside, even for a C shaped zone).

## Heatmap

Weighted heatmap: each point contributes with its value.

```ts
import { KnHeatmapLayer } from "kn-gmap-clusterer";

const heat = new KnHeatmapLayer<Measure>(map, {
	weight: (p) => p.value, // default: p.value, else 1
	radius: 25, // influence radius
	radiusUnit: "px", // 'px' (constant on screen) or 'm' (constant on the ground)
	minRadius: 1, // with 'm': min radius in px, keeps the far zooms visible
	aggregate: "sum", // 'sum' (density) or 'max' (strongest nearby value: noise, pollution...)
	intensity: 1,
	max: "auto", // density of the last color: 'auto' (max of the data at the zoom) or a value
	gradient: ["rgba(0,80,255,0)", "cyan", "lime", "yellow", "red"], // default: KN_HEAT_GRADIENT
	opacity: 0.75,
});
heat.load(points);
```

The points are aggregated in cells of a quarter of the radius for each zoom (100k points in about
50 ms, bounded number of splats), the splats are summed by the GPU in a float texture then colored
with the gradient: panning costs nothing.

For measurements (noise, pollution, temperature...), the density is misleading: many quiet sensors
look "hotter" than a single loud one, and with a radius in pixels the points drift apart when zooming
in. Use `aggregate: "max"` (each place shows the strongest nearby value, GPU MAX blending), a radius
in meters and a fixed `max`, so that a color always means the same level:

```ts
new KnHeatmapLayer<Sensor>(map, {
	aggregate: "max",
	weight: (s) => s.db - 40, // 40 dB = transparent
	max: 80, // 120 dB = last color
	radius: 1200,
	radiusUnit: "m",
	minRadius: 12,
});
```

## Maps manager

```ts
import { KnMaps, knTiles, staticMapUrl } from "kn-gmap-clusterer";

KnMaps.configure({
	apiKey,
	language: "fr",
	defaults: { mapTypeId: "hybrid", gestureHandling: "greedy", maxZoom: 19 }, // google.maps.MapOptions
	tiles: [knTiles.osm(), knTiles.osmFr(), knTiles.ignPlan(), knTiles.ignPhotos()],
	mapTypeControl: { position: "TOP_RIGHT", style: "DROPDOWN_MENU" },
	streetView: { enableCloseButton: true },
	theme: "auto", // 'light' | 'dark' | 'auto' (follows the system)
	transparentBackground: true,
	onMapTypeChange: (map, type, key) => {},
});

const { el, map } = await KnMaps.get("alarms"); // created once, then reused
container.append(el);
KnMaps.release("alarms"); // detached, layers cleared, instance kept for the next get()
KnMaps.setTheme("dark");

staticMapUrl(apiKey, { x: 2.35, y: 48.85 }); // thumbnail URL (satellite, 458x250, red marker)
```

Custom tiles: `knTiles.xyz({ id, name, url: "https://.../{z}/{x}/{y}.png" })` or
`knTiles.wmts({ id, name, url, layer, format })`.

## Vue 3

```ts
import { KnGmapPlugin } from "kn-gmap-clusterer/vue";
app.use(KnGmapPlugin);
```

```vue
<KnMap map-key="main" v-model:center="center" v-model:zoom="zoom">
	<KnClusterLayer :points="points" :options="options" @marker-click="onClick">
		<!-- Vue content of the info window (reactive) -->
		<template #info="{ point, duplicates }">
			<MyCard :item="point" />
		</template>
	</KnClusterLayer>
	<KnZoneLayer :points="sites" v-model:open="openZone" />
	<KnHeatmapLayer :points="measures" :options="{ radius: 30 }" />
	<KnRouteLayer :points="track" />
	<KnHtmlMarker :x="2.35" :y="48.85"><div class="popup">Paris</div></KnHtmlMarker>
</KnMap>
```

Use `shallowRef` for the points: deep reactivity on large arrays is very slow. Components using
the same `map-key` reuse the same Google Maps instance.

## Migration from v4

| v4 | v5 |
| --- | --- |
| global script `KnGmapClusterer` | `import { KnGmapClusterer } from "kn-gmap-clusterer"` (UMD still available) |
| `load(points, autoCenterZoom)` | `load(points, { fit })`, returns a `Promise` |
| `getMarkers()` | `getVisible()` |
| `clearMarkers()` | `clear()` / `destroy()` |
| `getBoundsZoomLevel(bounds)` | `fitBounds()` |
| `clusterIcon`, `markerIcon` (Google icons) | `cluster.style`, `marker.icon` (`KnIcon`) |
| `clusterFont*`, `markerFont*` | `cluster.font`, `marker.font` (`{ color, size, family, weight, halo }`) |
| `mergeDuplicates: true` | `duplicates: "merge"` (default `"spiderfy"`) |
| `onMarkerClick(e)` Google event, `this.kData` | `onMarkerClick({ point, index, duplicates, latLng })` |
| `radius: 256, extent: 512` | `radius: 60, extent: 256` (same ratio: `radius: 128` for the v4 look) |

Points keep the same format: `{ x: lng, y: lat, ...custom }` (an `id` is no longer required).

## Development

```bash
pnpm install
pnpm dev        # examples on http://localhost:5173 (API key in .env.local: VITE_GMAPS_KEY=...)
pnpm check      # biome + typecheck + tests (node:test)
pnpm build      # dist/: ESM, UMD, types
```

Index build benchmark against supercluster: `node --experimental-strip-types scripts/bench-cluster.ts path/to/supercluster/index.js`.

## Changelog

See the changelog [here](CHANGELOG.md)

## License

MIT, see [LICENSE.txt](LICENSE.txt)
