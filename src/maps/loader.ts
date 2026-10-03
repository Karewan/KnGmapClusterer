/**
 * Load the Google Maps JavaScript API once
 */

export interface KnLoaderOptions {
	/** Google Maps API key */
	readonly apiKey: string;
	/** API version (default 'weekly') */
	readonly version?: string;
	/** language of the map labels (ex: 'fr') */
	readonly language?: string;
	/** region bias (ex: 'FR') */
	readonly region?: string;
	/** extra libraries (ex: ['places']) */
	readonly libraries?: readonly string[];
}

const CALLBACK = "__knGmapLoaded";
let loading: Promise<void> | null = null;

/** Is the Maps API already available? */
export function isGoogleMapsLoaded(): boolean {
	return typeof google !== "undefined" && typeof google.maps?.Map === "function";
}

/** Build the script URL of the API */
export function googleMapsUrl(o: KnLoaderOptions): string {
	const params = new URLSearchParams({
		v: o.version ?? "weekly",
		loading: "async",
	});
	if (o.apiKey) {
		params.set("key", o.apiKey);
	}
	if (o.language) {
		params.set("language", o.language);
	}
	if (o.region) {
		params.set("region", o.region);
	}
	if (o.libraries?.length) {
		params.set("libraries", o.libraries.join(","));
	}
	params.set("callback", CALLBACK);
	return `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
}

/**
 * Load the API (no-op if it is already loaded, by this function or by a script tag)
 */
export function loadGoogleMaps(options: KnLoaderOptions): Promise<void> {
	if (isGoogleMapsLoaded()) {
		return Promise.resolve();
	}
	if (!loading) {
		loading = new Promise<void>((resolve, reject) => {
			const w = window as unknown as Record<string, unknown>;
			w[CALLBACK] = () => {
				delete w[CALLBACK];
				// with loading=async, the classes are loaded on demand
				google.maps
					.importLibrary("maps")
					.then(() => resolve())
					.catch(reject);
			};
			const script = document.createElement("script");
			script.src = googleMapsUrl(options);
			script.async = true;
			const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
			if (nonce) {
				script.nonce = nonce;
			}
			script.onerror = () => {
				loading = null;
				reject(new Error("KnGmapClusterer: the Google Maps API could not be loaded"));
			};
			document.head.append(script);
		});
	}
	return loading;
}
