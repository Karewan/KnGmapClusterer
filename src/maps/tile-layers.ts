/**
 * Custom tile layers (OpenStreetMap, IGN...) as Google Maps map types
 */

export interface KnTileLayer {
	/** map type id (used in mapTypeIds / setMapTypeId) */
	readonly id: string;
	/** name displayed in the map type control */
	readonly name: string;
	readonly minZoom: number;
	readonly maxZoom: number;
	/** attribution displayed when the layer is active */
	readonly attribution: string | null;
	/** URL of a tile, null outside of the world */
	getTileUrl(x: number, y: number, zoom: number): string | null;
	/** Create the Google Maps map type */
	create(): google.maps.MapType;
}

interface BaseOptions {
	readonly id: string;
	readonly name: string;
	readonly minZoom?: number;
	readonly maxZoom?: number;
	readonly attribution?: string | null;
	readonly tileSize?: number;
}

export interface KnXyzOptions extends BaseOptions {
	/**
	 * URL template with {x}, {y}, {z} and optionally {s} (subdomain),
	 * or a function building the URL
	 */
	readonly url: string | ((x: number, y: number, zoom: number) => string);
	/** subdomains used for {s} (default ['a', 'b', 'c']) */
	readonly subdomains?: readonly string[];
}

export interface KnWmtsOptions extends BaseOptions {
	/** WMTS endpoint (KVP) */
	readonly url: string;
	readonly layer: string;
	/** image format (default image/png) */
	readonly format?: string;
	/** default 'normal' */
	readonly style?: string;
	/** default 'PM' (web mercator) */
	readonly tileMatrixSet?: string;
}

/** Wrap x around the world, null if y is outside */
function normalize(
	x: number,
	y: number,
	zoom: number,
):
	| [
			number,
			number,
	  ]
	| null {
	const n = 2 ** zoom;
	if (y < 0 || y >= n) {
		return null;
	}
	return [
		((x % n) + n) % n,
		y,
	];
}

function createLayer(
	o: BaseOptions,
	url: (x: number, y: number, z: number) => string,
): KnTileLayer {
	const layer: KnTileLayer = {
		id: o.id,
		name: o.name,
		minZoom: o.minZoom ?? 0,
		maxZoom: o.maxZoom ?? 19,
		attribution: o.attribution ?? null,
		getTileUrl(x, y, zoom) {
			const t = normalize(x, y, zoom);
			return t ? url(t[0], t[1], zoom) : null;
		},
		create() {
			const size = o.tileSize ?? 256;
			return new google.maps.ImageMapType({
				name: o.name,
				alt: o.name,
				minZoom: layer.minZoom,
				maxZoom: layer.maxZoom,
				tileSize: new google.maps.Size(size, size),
				getTileUrl: (coord, zoom) => layer.getTileUrl(coord.x, coord.y, zoom),
			});
		},
	};
	return layer;
}

/** XYZ tiles (OpenStreetMap like) */
function xyz(o: KnXyzOptions): KnTileLayer {
	const subdomains = o.subdomains ?? [
		"a",
		"b",
		"c",
	];
	const template = o.url;
	return createLayer(o, (x, y, z) =>
		typeof template === "function"
			? template(x, y, z)
			: template
					.replace("{s}", subdomains[(x + y) % subdomains.length] ?? "")
					.replace("{z}", String(z))
					.replace("{x}", String(x))
					.replace("{y}", String(y)),
	);
}

/** WMTS tiles (KVP requests, ex: IGN Géoplateforme) */
function wmts(o: KnWmtsOptions): KnTileLayer {
	return createLayer(o, (x, y, z) => {
		const params = new URLSearchParams({
			SERVICE: "WMTS",
			VERSION: "1.0.0",
			REQUEST: "GetTile",
			LAYER: o.layer,
			STYLE: o.style ?? "normal",
			FORMAT: o.format ?? "image/png",
			TILEMATRIXSET: o.tileMatrixSet ?? "PM",
			TILEMATRIX: String(z),
			TILEROW: String(y),
			TILECOL: String(x),
		});
		return `${o.url}?${params.toString()}`;
	});
}

const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const IGN_WMTS = "https://data.geopf.fr/wmts";

type Overrides = Partial<BaseOptions>;

/**
 * Tile layers factories
 */
export const knTiles: {
	readonly xyz: typeof xyz;
	readonly wmts: typeof wmts;
	readonly osm: (o?: Overrides) => KnTileLayer;
	readonly osmFr: (o?: Overrides) => KnTileLayer;
	readonly ignPlan: (o?: Overrides) => KnTileLayer;
	readonly ignPhotos: (o?: Overrides) => KnTileLayer;
} = {
	xyz,
	wmts,
	/** OpenStreetMap (single domain, the a/b/c subdomains are deprecated) */
	osm: (o = {}) =>
		xyz({
			id: "osm",
			name: "OpenStreetMap",
			url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
			attribution: OSM_ATTRIBUTION,
			...o,
		}),
	/** OpenStreetMap France */
	osmFr: (o = {}) =>
		xyz({
			id: "osm_fr",
			name: "OpenStreetMap FR",
			url: "https://{s}.tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png",
			maxZoom: 20,
			attribution: OSM_ATTRIBUTION,
			...o,
		}),
	/** IGN Plan v2 */
	ignPlan: (o = {}) =>
		wmts({
			id: "ign_plan",
			name: "IGN Plan",
			url: IGN_WMTS,
			layer: "GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2",
			format: "image/png",
			attribution: "© IGN",
			...o,
		}),
	/** IGN orthophotos */
	ignPhotos: (o = {}) =>
		wmts({
			id: "ign_photos",
			name: "IGN Photographies",
			url: IGN_WMTS,
			layer: "ORTHOIMAGERY.ORTHOPHOTOS",
			format: "image/jpeg",
			attribution: "© IGN",
			...o,
		}),
};
