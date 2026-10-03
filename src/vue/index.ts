/**
 * Vue 3 components: kn-gmap-clusterer/vue
 *
 * <KnMap map-key="main" v-model:center="center" v-model:zoom="zoom">
 *   <KnClusterLayer :points="points" :options="options" @marker-click="onClick" />
 *   <KnRouteLayer :points="track" />
 *   <KnHtmlMarker :x="2.35" :y="48.85"><div class="popup">Paris</div></KnHtmlMarker>
 * </KnMap>
 */

import {
	type App,
	type DefineSetupFnComponent,
	defineComponent,
	h,
	type InjectionKey,
	inject,
	markRaw,
	onBeforeUnmount,
	onMounted,
	provide,
	type ShallowRef,
	type Slots,
	shallowRef,
	Teleport,
	toRaw,
	type VNode,
	watch,
} from "vue";
import type { KnAggregates } from "../core/aggregate.ts";
import { type KnClustererOptions, KnGmapClusterer } from "../layers/cluster-layer.ts";
import { KnHeatmapLayer, type KnHeatmapOptions } from "../layers/heatmap-layer.ts";
import { type KnRouteEvent, KnRouteLayer, type KnRouteOptions } from "../layers/route-layer.ts";
import { type KnZoneEvent, KnZoneLayer, type KnZoneOptions } from "../layers/zone-layer.ts";
import { KnMaps } from "../maps/map-manager.ts";
import { type KnHtmlAnchor, KnHtmlMarker } from "../render/html-marker.ts";
import type { KnInfoContent } from "../render/info-window.ts";
import type { KnClusterEvent, KnHoverEvent, KnMarkerEvent, KnPoint } from "../types.ts";

/** Injection key of the map of the closest <KnMap> */
export const KN_MAP_KEY: InjectionKey<ShallowRef<google.maps.Map | null>> = Symbol("kn-map");

/** Map of the closest <KnMap> (null until it is ready) */
export function useKnMap(): ShallowRef<google.maps.Map | null> {
	const map = inject(KN_MAP_KEY, null);
	if (!map) {
		throw new Error("useKnMap() must be used inside a <KnMap>");
	}
	return map;
}

/**
 * Scoped slot "info" rendered in the info window (Teleport): the content stays reactive, also when
 * browsing the duplicates
 */
function useInfoSlot<E>(slots: Slots): {
	readonly content: ((e: E) => KnInfoContent) | undefined;
	render(): VNode | null;
} {
	const event = shallowRef<E | null>(null);
	const el = document.createElement("div");
	el.className = "kn-info__vue";
	return {
		content: slots["info"]
			? (e: E) => {
					event.value = e;
					return el;
				}
			: undefined,
		render: () => {
			const slot = slots["info"];
			return slot && event.value
				? h(
						Teleport,
						{
							to: el,
						},
						slot(event.value),
					)
				: null;
		},
	};
}

/** Run a callback once the map is available (immediately if it already is) */
function whenMap(cb: (map: google.maps.Map) => void): void {
	const map = useKnMap();
	const stop = watch(
		map,
		(m) => {
			if (m) {
				cb(m);
				queueMicrotask(() => stop());
			}
		},
		{
			immediate: true,
		},
	);
}

// -------------------------------------------------------------------------------------------------
// <KnMap>
// -------------------------------------------------------------------------------------------------

export interface KnMapProps {
	/** key of the map instance in KnMaps (instances are reused between components) */
	mapKey?: string;
	/** extra map options */
	options?: google.maps.MapOptions;
	/** center (v-model:center), x = longitude, y = latitude */
	center?: KnPoint;
	/** zoom (v-model:zoom) */
	zoom?: number;
	/** map type (v-model:mapType) */
	mapType?: string;
}

export type KnMapEmits = {
	"update:center": (center: KnPoint) => boolean;
	"update:zoom": (zoom: number) => boolean;
	"update:mapType": (mapType: string) => boolean;
	ready: (map: google.maps.Map) => boolean;
};

const MAP_EMITS: KnMapEmits = {
	"update:center": () => true,
	"update:zoom": () => true,
	"update:mapType": () => true,
	ready: () => true,
};

export const KnMap: DefineSetupFnComponent<KnMapProps, KnMapEmits> = defineComponent(
	(props: KnMapProps, { emit, slots }) => {
		const container = shallowRef<HTMLDivElement | null>(null);
		const map = shallowRef<google.maps.Map | null>(null);
		const key = props.mapKey ?? "default";
		const listeners: google.maps.MapsEventListener[] = [];
		let unmounted = false;
		provide(KN_MAP_KEY, map);

		onMounted(async () => {
			const options: google.maps.MapOptions = {
				...props.options,
			};
			if (props.center) {
				options.center = {
					lat: props.center.y,
					lng: props.center.x,
				};
			}
			if (props.zoom !== undefined) {
				options.zoom = props.zoom;
			}
			if (props.mapType) {
				options.mapTypeId = props.mapType;
			}
			const instance = await KnMaps.get(key, options);
			if (unmounted) {
				KnMaps.release(key);
				return;
			}
			container.value?.append(instance.el);
			const m = instance.map;

			listeners.push(
				m.addListener("idle", () => {
					const c = m.getCenter();
					if (c) {
						emit("update:center", {
							x: c.lng(),
							y: c.lat(),
						});
					}
					emit("update:zoom", m.getZoom() ?? 0);
				}),
				m.addListener("maptypeid_changed", () =>
					emit("update:mapType", String(m.getMapTypeId())),
				),
			);
			map.value = markRaw(m);
			emit("ready", m);
		});

		onBeforeUnmount(() => {
			unmounted = true;
			for (const l of listeners) {
				l.remove();
			}
			if (map.value) {
				KnMaps.release(key);
			}
			map.value = null;
		});

		// external changes
		watch(
			() => props.center,
			(c) => {
				const m = map.value;
				const cur = m?.getCenter();
				if (
					m &&
					c &&
					cur &&
					(Math.abs(cur.lng() - c.x) > 1e-9 || Math.abs(cur.lat() - c.y) > 1e-9)
				) {
					m.setCenter({
						lat: c.y,
						lng: c.x,
					});
				}
			},
		);
		watch(
			() => props.zoom,
			(z) => {
				if (map.value && z !== undefined && z !== map.value.getZoom()) {
					map.value.setZoom(z);
				}
			},
		);
		watch(
			() => props.mapType,
			(t) => {
				if (map.value && t && t !== map.value.getMapTypeId()) {
					map.value.setMapTypeId(t);
				}
			},
		);
		watch(
			() => props.options,
			(o) => {
				if (map.value && o) {
					map.value.setOptions(o);
				}
			},
		);

		return () =>
			h(
				"div",
				{
					ref: container,
					class: "kn-map",
					style: "position:relative;width:100%;height:100%",
				},
				[
					map.value ? slots["default"]?.() : null,
				],
			);
	},
	{
		name: "KnMap",
		props: [
			"mapKey",
			"options",
			"center",
			"zoom",
			"mapType",
		],
		emits: MAP_EMITS,
	},
);

// -------------------------------------------------------------------------------------------------
// <KnClusterLayer>
// -------------------------------------------------------------------------------------------------

export interface KnClusterLayerProps {
	/** points (not deeply reactive: replace the array to update them) */
	points?: readonly KnPoint[];
	options?: KnClustererOptions<KnPoint, KnAggregates<KnPoint>>;
	/** fit the map to the points on load (default true) */
	fit?: boolean;
	filter?: ((point: KnPoint, index: number) => boolean) | null;
}

export type KnClusterLayerEmits = {
	markerClick: (e: KnMarkerEvent<KnPoint>) => boolean;
	clusterClick: (e: KnClusterEvent<KnAggregates<KnPoint>>) => boolean;
	hover: (e: KnHoverEvent<KnPoint, KnAggregates<KnPoint>> | null) => boolean;
	loaded: (clusterer: KnGmapClusterer) => boolean;
};

const CLUSTER_EMITS: KnClusterLayerEmits = {
	markerClick: () => true,
	clusterClick: () => true,
	hover: () => true,
	loaded: () => true,
};

export const KnClusterLayer: DefineSetupFnComponent<KnClusterLayerProps, KnClusterLayerEmits> =
	defineComponent(
		(props: KnClusterLayerProps, { emit, expose, slots }) => {
			let clusterer: KnGmapClusterer | null = null;
			const info = useInfoSlot<KnMarkerEvent<KnPoint>>(slots);

			const options = (): KnClustererOptions<KnPoint, KnAggregates<KnPoint>> => {
				const o = props.options ?? {};
				const onCluster = o.onClusterClick;
				return {
					...o,
					...(info.content
						? {
								infoWindow: info.content,
							}
						: {}),
					onMarkerClick: (e) => {
						o.onMarkerClick?.(e);
						emit("markerClick", e);
					},
					onClusterClick:
						typeof onCluster === "function"
							? (e) => {
									onCluster(e);
									emit("clusterClick", e);
								}
							: (onCluster ?? "zoom"),
					onHover: (e) => {
						o.onHover?.(e);
						emit("hover", e);
					},
				};
			};

			const load = async (fit: boolean) => {
				if (clusterer) {
					await clusterer.load(toRaw(props.points ?? []), {
						fit,
					});
					emit("loaded", clusterer);
				}
			};

			whenMap((map) => {
				clusterer = new KnGmapClusterer(map, options());
				if (props.filter) {
					void clusterer.setFilter(props.filter);
				}
				void load(props.fit ?? true);
			});

			watch(
				() => props.points,
				() => load(false),
			);
			watch(
				() => props.options,
				() => clusterer?.setOptions(options()),
			);
			watch(
				() => props.filter,
				(f) => clusterer?.setFilter(f ?? null),
			);

			onBeforeUnmount(() => {
				clusterer?.destroy();
				clusterer = null;
			});

			expose({
				getClusterer: () => clusterer,
			});
			return () => info.render();
		},
		{
			name: "KnClusterLayer",
			props: [
				"points",
				"options",
				"fit",
				"filter",
			],
			emits: CLUSTER_EMITS,
		},
	);

// -------------------------------------------------------------------------------------------------
// <KnRouteLayer>
// -------------------------------------------------------------------------------------------------

export interface KnRouteLayerProps {
	/** points of the route, in order (not deeply reactive: replace the array to update them) */
	points?: readonly KnPoint[];
	options?: KnRouteOptions<KnPoint>;
	/** fit the map to the route on load (default true) */
	fit?: boolean;
}

export type KnRouteLayerEmits = {
	pointClick: (e: KnRouteEvent<KnPoint>) => boolean;
	hover: (e: KnRouteEvent<KnPoint> | null) => boolean;
};

const ROUTE_EMITS: KnRouteLayerEmits = {
	pointClick: () => true,
	hover: () => true,
};

export const KnRouteLayerComponent: DefineSetupFnComponent<KnRouteLayerProps, KnRouteLayerEmits> =
	defineComponent(
		(props: KnRouteLayerProps, { emit, expose, slots }) => {
			let route: KnRouteLayer | null = null;
			const info = useInfoSlot<KnRouteEvent<KnPoint>>(slots);

			const options = (): KnRouteOptions<KnPoint> => {
				const o = props.options ?? {};
				return {
					...o,
					...(info.content
						? {
								infoWindow: info.content,
							}
						: {}),
					onPointClick: (e) => {
						o.onPointClick?.(e);
						emit("pointClick", e);
					},
					onHover: (e) => {
						o.onHover?.(e);
						emit("hover", e);
					},
				};
			};

			whenMap((map) => {
				route = new KnRouteLayer(map, options());
				void route.load(toRaw(props.points ?? []), {
					fit: props.fit ?? true,
				});
			});

			watch(
				() => props.points,
				(p) =>
					route?.load(toRaw(p ?? []), {
						fit: false,
					}),
			);
			watch(
				() => props.options,
				() => route?.setOptions(options()),
			);

			onBeforeUnmount(() => {
				route?.destroy();
				route = null;
			});

			expose({
				getRoute: () => route,
			});
			return () => info.render();
		},
		{
			name: "KnRouteLayer",
			props: [
				"points",
				"options",
				"fit",
			],
			emits: ROUTE_EMITS,
		},
	);

// -------------------------------------------------------------------------------------------------
// <KnHtmlMarker>
// -------------------------------------------------------------------------------------------------

export interface KnHtmlMarkerProps {
	/** longitude */
	x: number;
	/** latitude */
	y: number;
	anchor?: KnHtmlAnchor;
	offset?: readonly [
		number,
		number,
	];
	zIndex?: number;
}

export const KnHtmlMarkerComponent: DefineSetupFnComponent<KnHtmlMarkerProps> = defineComponent(
	(props: KnHtmlMarkerProps, { slots }) => {
		const marker = shallowRef<KnHtmlMarker | null>(null);

		whenMap((map) => {
			marker.value = markRaw(
				new KnHtmlMarker(map, {
					position: {
						x: props.x,
						y: props.y,
					},
					...(props.anchor
						? {
								anchor: props.anchor,
							}
						: {}),
					...(props.offset
						? {
								offset: props.offset,
							}
						: {}),
					...(props.zIndex !== undefined
						? {
								zIndex: props.zIndex,
							}
						: {}),
				}),
			);
		});

		watch(
			() =>
				[
					props.x,
					props.y,
					props.anchor,
					props.offset,
					props.zIndex,
				] as const,
			([x, y, anchor, offset, zIndex]) => {
				marker.value?.setOptions({
					position: {
						x,
						y,
					},
					...(anchor
						? {
								anchor,
							}
						: {}),
					...(offset
						? {
								offset,
							}
						: {}),
					...(zIndex !== undefined
						? {
								zIndex,
							}
						: {}),
				});
			},
		);

		onBeforeUnmount(() => {
			marker.value?.destroy();
			marker.value = null;
		});

		// the slot is rendered inside the marker element
		return () =>
			marker.value
				? h(
						Teleport,
						{
							to: marker.value.element,
						},
						slots["default"]?.(),
					)
				: null;
	},
	{
		name: "KnHtmlMarker",
		props: [
			"x",
			"y",
			"anchor",
			"offset",
			"zIndex",
		],
	},
);

// -------------------------------------------------------------------------------------------------
// <KnZoneLayer>
// -------------------------------------------------------------------------------------------------

export interface KnZoneLayerProps {
	/** points with a group (not deeply reactive: replace the array to update them) */
	points?: readonly KnPoint[];
	options?: KnZoneOptions<KnPoint>;
	/** fit the map to the points on load (default true) */
	fit?: boolean;
	/** key of the opened zone (v-model:open) */
	open?: string | number | null;
}

export type KnZoneLayerEmits = {
	"update:open": (key: string | number | null) => boolean;
	zoneClick: (e: KnZoneEvent<KnPoint>) => boolean;
	markerClick: (e: KnMarkerEvent<KnPoint>) => boolean;
};

const ZONE_EMITS: KnZoneLayerEmits = {
	"update:open": () => true,
	zoneClick: () => true,
	markerClick: () => true,
};

export const KnZoneLayerComponent: DefineSetupFnComponent<KnZoneLayerProps, KnZoneLayerEmits> =
	defineComponent(
		(props: KnZoneLayerProps, { emit, expose, slots }) => {
			let zones: KnZoneLayer | null = null;
			const info = useInfoSlot<KnMarkerEvent<KnPoint>>(slots);

			const options = (): KnZoneOptions<KnPoint> => {
				const o = props.options ?? {};
				return {
					...o,
					...(info.content
						? {
								infoWindow: info.content,
							}
						: {}),
					onZoneClick: (e) => {
						emit("zoneClick", e);
						return o.onZoneClick?.(e);
					},
					onZoneOpen: (z) => {
						o.onZoneOpen?.(z);
						emit("update:open", z ? z.key : null);
					},
					onMarkerClick: (e) => {
						o.onMarkerClick?.(e);
						emit("markerClick", e);
					},
				};
			};

			whenMap((map) => {
				zones = new KnZoneLayer(map, options());
				void zones
					.load(toRaw(props.points ?? []), {
						fit: props.fit ?? true,
					})
					.then(() => {
						if (props.open !== undefined) {
							zones?.open(props.open);
						}
					});
			});

			watch(
				() => props.points,
				(p) =>
					zones?.load(toRaw(p ?? []), {
						fit: false,
					}),
			);
			watch(
				() => props.options,
				() => zones?.setOptions(options()),
			);
			watch(
				() => props.open,
				(key) => {
					if (key !== undefined && (zones?.getOpenZone()?.key ?? null) !== key) {
						zones?.open(key);
					}
				},
			);

			onBeforeUnmount(() => {
				zones?.destroy();
				zones = null;
			});

			expose({
				getLayer: () => zones,
			});
			return () => info.render();
		},
		{
			name: "KnZoneLayer",
			props: [
				"points",
				"options",
				"fit",
				"open",
			],
			emits: ZONE_EMITS,
		},
	);

// -------------------------------------------------------------------------------------------------
// <KnHeatmapLayer>
// -------------------------------------------------------------------------------------------------

export interface KnHeatmapLayerProps {
	/** weighted points (not deeply reactive: replace the array to update them) */
	points?: readonly KnPoint[];
	options?: KnHeatmapOptions<KnPoint>;
	/** fit the map to the points on load (default true) */
	fit?: boolean;
}

export const KnHeatmapLayerComponent: DefineSetupFnComponent<KnHeatmapLayerProps> = defineComponent(
	(props: KnHeatmapLayerProps, { expose }) => {
		let heat: KnHeatmapLayer | null = null;

		whenMap((map) => {
			heat = new KnHeatmapLayer(map, props.options ?? {});
			heat.load(toRaw(props.points ?? []), {
				fit: props.fit ?? true,
			});
		});

		watch(
			() => props.points,
			(p) =>
				heat?.load(toRaw(p ?? []), {
					fit: false,
				}),
		);
		watch(
			() => props.options,
			(o) => heat?.setOptions(o ?? {}),
		);

		onBeforeUnmount(() => {
			heat?.destroy();
			heat = null;
		});

		expose({
			getLayer: () => heat,
		});
		return () => null;
	},
	{
		name: "KnHeatmapLayer",
		props: [
			"points",
			"options",
			"fit",
		],
	},
);

export {
	KnHeatmapLayerComponent as KnHeatmapLayer,
	KnHtmlMarkerComponent as KnHtmlMarker,
	KnRouteLayerComponent as KnRouteLayer,
	KnZoneLayerComponent as KnZoneLayer,
};

/** Vue plugin registering the components globally */
export const KnGmapPlugin: {
	install(app: App): void;
} = {
	install(app: App): void {
		app.component("KnMap", KnMap);
		app.component("KnClusterLayer", KnClusterLayer);
		app.component("KnRouteLayer", KnRouteLayerComponent);
		app.component("KnHtmlMarker", KnHtmlMarkerComponent);
		app.component("KnZoneLayer", KnZoneLayerComponent);
		app.component("KnHeatmapLayer", KnHeatmapLayerComponent);
	},
};
