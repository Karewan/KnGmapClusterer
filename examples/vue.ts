import { createApp, defineComponent, reactive, ref, shallowRef } from "vue";
import type { KnMarkerEvent, KnPoint, KnRouteEvent } from "../src/index.ts";
import { KnGmapPlugin } from "../src/vue/index.ts";
import { apiKey, randomPoints } from "./shared.ts";

/** Page 1: clusters */
const ClustersPage = defineComponent({
	setup() {
		// shallowRef: the points must not be deeply reactive (200k proxies would be very slow)
		const points = shallowRef(randomPoints(50_000));
		const selected = ref("");
		const likes = reactive<Record<number, number>>({});
		return {
			points,
			likes,
			selected,
			onClick: (e: KnMarkerEvent<KnPoint>) => {
				selected.value = `Point ${e.index}`;
			},
			reload: () => {
				points.value = randomPoints(50_000, Math.round(Math.random() * 1000));
			},
		};
	},
	template: `
		<KnClusterLayer :points="points" @marker-click="onClick">
			<!-- Vue content of the info window (reactive) -->
			<template #info="{ point, index }">
				<b>Point {{ index }}</b><br>
				Type: {{ point.type }}<br>
				<button type="button" @click="likes[index] = (likes[index] ?? 0) + 1">
					👍 {{ likes[index] ?? 0 }}
				</button>
			</template>
		</KnClusterLayer>
		<div class="panel" style="top: auto; bottom: 12px">
			<button type="button" @click="reload">New points</button>
			<div id="info">{{ selected || '50,000 points' }}</div>
		</div>
	`,
});

/** Page 2: route + HTML marker */
const RoutePage = defineComponent({
	setup() {
		const track = shallowRef(
			Array.from(
				{
					length: 2000,
				},
				(_, i) => ({
					x: 2.35 + i * 0.0012 + Math.sin(i / 40) * 0.01,
					y: 48.85 - i * 0.0008 + Math.cos(i / 30) * 0.008,
				}),
			),
		);
		const clicked = ref("");
		return {
			track,
			clicked,
			onPoint: (e: KnRouteEvent<KnPoint>) => {
				clicked.value = `Route point ${e.index}`;
			},
		};
	},
	template: `
		<KnRouteLayer :points="track" :options="{ points: { minZoom: 14 } }" @point-click="onPoint" />
		<KnHtmlMarker :x="2.35" :y="48.85" anchor="bottom" :offset="[0, -44]">
			<div class="popup">Start (Vue component)</div>
		</KnHtmlMarker>
		<div class="panel" style="top: auto; bottom: 12px">
			<div id="info">{{ clicked || 'Click a point (zoom ≥ 14)' }}</div>
		</div>
	`,
});

const App = defineComponent({
	components: {
		ClustersPage,
		RoutePage,
	},
	setup() {
		const page = ref<"clusters" | "route">("clusters");
		const center = ref<KnPoint>({
			x: 2.4,
			y: 46.6,
		});
		const zoom = ref(6);
		return {
			page,
			center,
			zoom,
			// debug access from the console
			onReady: (map: google.maps.Map) =>
				Object.assign(window, {
					knMap: map,
				}),
			mapOptions: apiKey
				? {}
				: {
						mapTypeId: "osm",
					},
		};
	},
	template: `
		<div id="map">
			<!-- same map-key: both pages reuse the same Google Maps instance -->
			<KnMap map-key="vue" v-model:center="center" v-model:zoom="zoom" :options="mapOptions" @ready="onReady">
				<ClustersPage v-if="page === 'clusters'" />
				<RoutePage v-else />
			</KnMap>
		</div>
		<div class="panel">
			<h1>Vue 3</h1>
			<div>Two pages, a single map instance. <a href="../index.html">← examples</a></div>
			<div class="row">
				<button type="button" :class="{ active: page === 'clusters' }" @click="page = 'clusters'">Clusters</button>
				<button type="button" :class="{ active: page === 'route' }" @click="page = 'route'">Route</button>
			</div>
			<div id="fps">zoom {{ zoom }} · {{ center.y.toFixed(3) }}, {{ center.x.toFixed(3) }}</div>
		</div>
	`,
});

createApp(App).use(KnGmapPlugin).mount("#app");
