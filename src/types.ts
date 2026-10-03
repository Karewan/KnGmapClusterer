import type { KnAggregates, KnAggregateValues } from "./core/aggregate.ts";
import type { KnFont, KnIcon } from "./render/icons.ts";

/** A point: x = longitude, y = latitude (custom properties allowed) */
export interface KnPoint {
	readonly x: number;
	readonly y: number;
}

/** A cluster */
export interface KnCluster<A = KnAggregates<unknown>> {
	/** cluster id (stable for a given dataset and options) */
	readonly id: number;
	/** longitude */
	readonly x: number;
	/** latitude */
	readonly y: number;
	/** number of points */
	readonly count: number;
	/** abbreviated number of points (1.2k, 25k...) */
	readonly countAbbr: string;
	/** computed aggregates (see the `aggregate` option) */
	readonly agg: KnAggregateValues<A>;
}

/** Style of a cluster (returned by `cluster.style`) */
export interface KnClusterStyle {
	/** fill color */
	readonly color?: string;
	/** diameter in CSS px */
	readonly size?: number;
	readonly borderColor?: string;
	/** border width in CSS px */
	readonly borderWidth?: number;
	/** text displayed, default: abbreviated count, null to hide it */
	readonly text?: string | null;
	readonly font?: KnFont;
	/** draw an icon instead of the circle */
	readonly icon?: KnIcon;
}

/** Donut drawn around the clusters, from a countBy aggregate */
export interface KnDonutOptions {
	/** name of a `countBy` aggregate */
	readonly aggregate: string;
	/** color of each category */
	readonly colors: Readonly<Record<string, string>> | ((category: string) => string);
	/** ring width in CSS px (default 30% of the radius) */
	readonly width?: number;
}

/** Event common properties */
export interface KnEventBase {
	readonly latLng: google.maps.LatLng | null;
	readonly domEvent: Event | null;
}

export interface KnMarkerEvent<T> extends KnEventBase {
	readonly type: "point";
	readonly point: T;
	/** index of the point in the loaded array */
	readonly index: number;
	/** other points at the exact same position (when `duplicates` is 'merge') */
	readonly duplicates: readonly T[];
}

export interface KnClusterEvent<A> extends KnEventBase {
	readonly type: "cluster";
	readonly cluster: KnCluster<A>;
}

export type KnHoverEvent<T, A> = KnMarkerEvent<T> | KnClusterEvent<A>;
