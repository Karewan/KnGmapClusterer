KnGmapClusterer Changelog
==========

5.0.1 (2026-10-06):
----------------------------
* Tile layers: referrerPolicy option (forced on the tile images, even when the page is in no-referrer)
* Fixed: OSM tiles refused when the page is in no-referrer, the origin is now always sent as Referer (knTiles.osm / osmFr, referrerPolicy: null to keep the page policy)

5.0.0 (2026-10-03):
----------------------------
* Breaking change: full rewrite in strict TypeScript, published on npm (ESM + UMD + types)
* Breaking change: new options and API (see the migration guide in the README)
* WebGL2 rendering on raster maps (no mapId needed): 200k+ markers stay fluid
* Clustering 30 to 40% faster than supercluster 9 (hashed grid index, int32 coordinates), index built in a Web Worker
* add(), remove() and refresh() for a few markers (with or without clustering)
* Dynamic cluster style (closure), declarative aggregates (sum, min, max, avg, countBy), donut clusters
* Pinned markers (never clustered), duplicates spiderfied, browsed in the info window or merged, filters, zoom animations
* Info window styled with CSS (one per map, closed by a click outside), Vue content with the #info slot
* SVG icons builder (knSvg): pins and badges with glyphs
* KnZoneLayer: exact perimeter (concave hull) of groups of points instead of clusters, opened on click, optional clustering inside the opened zone
* KnHeatmapLayer: weighted heatmap (value of each point), GPU accumulation in a float texture, density (sum) or strongest value (max) mode, radius in px or meters
* KnRouteLayer: routes with direction arrows, per segment color, zoom dependent points, statistics
* KnMaps: Google Maps loader and instances manager (reuse), OSM / IGN tile layers, themes, Street View
* staticMapUrl(), KnHtmlMarker, Vue 3 components (kn-gmap-clusterer/vue)
* Fixed: first render with old data when autoCenterZoom = false, nothing drawn when the view did not change on load, markers without id overwriting each other

4.0.2 (2025-03-08):
----------------------------
* Added autoCenterZoom paramater to the load method

4.0.1 (2024-05-03):
----------------------------
* Breaking change: k_data renamed kData
* Miscellaneous fixes and improvements

4.0.0 (2023-12-23):
----------------------------
* Reduced memory footprint
* Miscellaneous fixes and improvements

3.0.0 (2023-03-21):
----------------------------
* Breaking change: KnGmapClusterer need to be instantiated
