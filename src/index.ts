export type {
	KnAggregate,
	KnAggregates,
	KnAggregateValue,
	KnAggregateValues,
} from "./core/aggregate.ts";
export type { HeatAggregate as KnHeatAggregate } from "./core/heatmap.ts";
export { abbreviateCount, latY, lngX, xLng, yLat } from "./core/mercator.ts";
export { haversine, type KnRouteStats, routeStats } from "./core/route-stats.ts";
export {
	type KnClustererOptions,
	type KnClusterOptions,
	KnGmapClusterer,
	type KnLoadOptions,
	type KnMarkerOptions,
} from "./layers/cluster-layer.ts";
export {
	KN_HEAT_GRADIENT,
	KnHeatmapLayer,
	type KnHeatmapOptions,
} from "./layers/heatmap-layer.ts";
export {
	type KnRouteArrows,
	type KnRouteEvent,
	KnRouteLayer,
	type KnRouteOptions,
	type KnRoutePoints,
} from "./layers/route-layer.ts";
export {
	type KnZone,
	type KnZoneEvent,
	type KnZoneLabelOptions,
	KnZoneLayer,
	type KnZoneMarkerOptions,
	type KnZoneOptions,
} from "./layers/zone-layer.ts";
export { isGoogleMapsLoaded, type KnLoaderOptions, loadGoogleMaps } from "./maps/loader.ts";
export {
	type KnControlPosition,
	type KnMapInstance,
	KnMapManager,
	KnMaps,
	type KnMapsConfig,
	type KnStreetViewOptions,
	type KnTheme,
	type KnThemeMode,
} from "./maps/map-manager.ts";
export { type KnStaticMapOptions, type KnStaticMarker, staticMapUrl } from "./maps/static-map.ts";
export { KN_DARK_STYLES, KN_LIGHT_STYLES } from "./maps/styles.ts";
export {
	type KnTileLayer,
	type KnWmtsOptions,
	type KnXyzOptions,
	knTiles,
} from "./maps/tile-layers.ts";
export {
	type KnHtmlAnchor,
	KnHtmlMarker,
	type KnHtmlMarkerOptions,
} from "./render/html-marker.ts";
export type {
	KnCircleIcon,
	KnFont,
	KnIcon,
	KnImageIcon,
	KnPinIcon,
} from "./render/icons.ts";
export {
	KN_INFO_CSS,
	type KnInfoContent,
	type KnInfoNav,
	type KnInfoOpenOptions,
	KnInfoWindow,
	type KnInfoWindowOptions,
} from "./render/info-window.ts";
export {
	KN_GLYPHS,
	type KnSvgBadgeOptions,
	type KnSvgPinOptions,
	knSvg,
} from "./render/svg-icons.ts";
export type {
	KnCluster,
	KnClusterEvent,
	KnClusterStyle,
	KnDonutOptions,
	KnEventBase,
	KnHoverEvent,
	KnMarkerEvent,
	KnPoint,
} from "./types.ts";
export { VERSION } from "./version.ts";
