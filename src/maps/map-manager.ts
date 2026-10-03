/**
 * Google Maps instances manager: creation, configuration and reuse of map instances.
 *
 * Creating a map is slow (and billed): in a single page application the same instance can be
 * reused by several views. Each instance is identified by a key, `get(key)` returns the existing
 * one (same element, same map) or creates it.
 */

import { KnOverlay } from "../render/overlay.ts";
import { type KnLoaderOptions, loadGoogleMaps } from "./loader.ts";
import { KN_DARK_STYLES, KN_LIGHT_STYLES } from "./styles.ts";
import type { KnTileLayer } from "./tile-layers.ts";

export type KnTheme = "light" | "dark";
export type KnThemeMode = KnTheme | "auto";
export type KnControlPosition = keyof typeof google.maps.ControlPosition;

export interface KnStreetViewOptions extends google.maps.StreetViewPanoramaOptions {
	/** position of the address control */
	readonly addressPosition?: KnControlPosition;
}

export interface KnMapsConfig extends Partial<KnLoaderOptions> {
	/** options of every map (google.maps.MapOptions, passed as is) */
	readonly defaults?: google.maps.MapOptions;
	/** custom tile layers added to the map types */
	readonly tiles?: readonly KnTileLayer[];
	/** map types of the control (default: Google types + tiles) */
	readonly mapTypeIds?: readonly string[];
	/** map type control, false to hide it */
	readonly mapTypeControl?:
		| false
		| {
				readonly position?: KnControlPosition;
				readonly style?: keyof typeof google.maps.MapTypeControlStyle;
		  };
	/** Street View panorama (hidden until used), false to disable it */
	readonly streetView?: KnStreetViewOptions | false;
	/** 'auto' follows the system color scheme (default 'light') */
	readonly theme?: KnThemeMode;
	/** styles of each theme */
	readonly styles?: {
		readonly light?: google.maps.MapTypeStyle[];
		readonly dark?: google.maps.MapTypeStyle[];
	};
	/** transparent map background (default false) */
	readonly transparentBackground?: boolean;
	/** CSS class of the map elements (default 'kn-gmap') */
	readonly className?: string;
	/** called when the map type of a map changes */
	readonly onMapTypeChange?: (map: google.maps.Map, mapTypeId: string, key: string) => void;
	/** called once after the creation of a map (extra setup) */
	readonly onCreate?: (instance: KnMapInstance) => void;
}

export interface KnMapInstance {
	readonly key: string;
	/** element holding the map: append it where the map must be displayed */
	readonly el: HTMLDivElement;
	readonly map: google.maps.Map;
}

const GOOGLE_TYPES = [
	"roadmap",
	"terrain",
	"satellite",
	"hybrid",
];

export class KnMapManager {
	private config: KnMapsConfig = {};
	private readonly instances = new Map<string, KnMapInstance>();
	private readonly pending = new Map<string, Promise<KnMapInstance>>();
	private media: MediaQueryList | null = null;
	private mode: KnThemeMode = "light";
	private current: KnTheme = "light";

	/** Global configuration (call it before the first get()) */
	configure(config: KnMapsConfig): void {
		this.config = {
			...this.config,
			...config,
		};
		if (config.theme) {
			this.setTheme(config.theme);
		}
	}

	/** Current theme */
	get theme(): KnTheme {
		return this.current;
	}

	/** Keys of the existing instances */
	keys(): string[] {
		return [
			...this.instances.keys(),
		];
	}

	/** Existing instance, without creating it */
	peek(key: string): KnMapInstance | undefined {
		return this.instances.get(key);
	}

	/**
	 * Get a map instance, created on first call (concurrent calls share the same creation)
	 * @param options map options applied to the instance (on creation and on reuse)
	 */
	get(key: string, options?: google.maps.MapOptions): Promise<KnMapInstance> {
		const existing = this.instances.get(key);
		if (existing) {
			if (options) {
				existing.map.setOptions(options);
			}
			return Promise.resolve(existing);
		}

		let p = this.pending.get(key);
		if (!p) {
			p = this.load()
				.then(() => {
					const instance = this.create(key, options);
					this.instances.set(key, instance);
					return instance;
				})
				.finally(() => this.pending.delete(key));
			this.pending.set(key, p);
		} else if (options) {
			p = p.then((instance) => {
				instance.map.setOptions(options);
				return instance;
			});
		}
		return p;
	}

	/**
	 * Detach a map from the page and clear its layers, the instance is kept for reuse
	 */
	release(key: string): void {
		const instance = this.instances.get(key);
		if (!instance) {
			return;
		}
		KnOverlay.peek(instance.map)?.clearLayers();
		instance.map.getStreetView()?.setVisible(false);
		instance.el.remove();
	}

	/** Really destroy an instance */
	destroy(key: string): void {
		const instance = this.instances.get(key);
		if (!instance) {
			return;
		}
		this.release(key);
		KnOverlay.peek(instance.map)?.destroy();
		google.maps.event.clearInstanceListeners(instance.map);
		this.instances.delete(key);
	}

	/** Change the theme of every map ('auto' follows the system color scheme) */
	setTheme(mode: KnThemeMode): void {
		this.mode = mode;
		if (mode === "auto" && typeof matchMedia !== "undefined") {
			if (!this.media) {
				this.media = matchMedia("(prefers-color-scheme: dark)");
				this.media.addEventListener("change", () => {
					if (this.mode === "auto") {
						this.applyTheme(this.media?.matches ? "dark" : "light");
					}
				});
			}
			this.applyTheme(this.media.matches ? "dark" : "light");
		} else {
			this.applyTheme(mode === "dark" ? "dark" : "light");
		}
	}

	private applyTheme(theme: KnTheme): void {
		this.current = theme;
		for (const { map } of this.instances.values()) {
			map.setOptions({
				styles: this.styles(),
			});
		}
	}

	private styles(): google.maps.MapTypeStyle[] {
		const s = this.config.styles;
		return this.current === "dark"
			? (s?.dark ?? KN_DARK_STYLES)
			: (s?.light ?? KN_LIGHT_STYLES);
	}

	/** Load the API (overridable for the tests) */
	protected load(): Promise<void> {
		const { apiKey } = this.config;
		if (apiKey === undefined) {
			return typeof google !== "undefined" && google.maps
				? Promise.resolve()
				: Promise.reject(
						new Error("KnMaps: apiKey missing, call KnMaps.configure() first"),
					);
		}
		return loadGoogleMaps({
			...this.config,
			apiKey,
		});
	}

	/** Create an instance (overridable for the tests) */
	protected create(key: string, options?: google.maps.MapOptions): KnMapInstance {
		const c = this.config;
		const el = document.createElement("div");
		el.className = c.className ?? "kn-gmap";
		el.style.width = "100%";
		el.style.height = "100%";

		const tiles = c.tiles ?? [];
		const control = c.mapTypeControl;
		const mapOptions: google.maps.MapOptions = {
			center: {
				lat: 46.6,
				lng: 2.4,
			},
			zoom: 5,
			...c.defaults,
			styles: this.styles(),
			mapTypeControl: control !== false,
			...(c.transparentBackground
				? {
						backgroundColor: "transparent",
					}
				: {}),
			...options,
		};
		if (control !== false) {
			mapOptions.mapTypeControlOptions = {
				mapTypeIds: [
					...(c.mapTypeIds ?? [
						...GOOGLE_TYPES,
						...tiles.map((t) => t.id),
					]),
				],
				style: google.maps.MapTypeControlStyle[control?.style ?? "DROPDOWN_MENU"],
				position: google.maps.ControlPosition[control?.position ?? "TOP_RIGHT"],
				...c.defaults?.mapTypeControlOptions,
			};
		}

		const map = new google.maps.Map(el, mapOptions);
		for (const t of tiles) {
			map.mapTypes.set(t.id, t.create());
		}

		if (c.streetView !== false) {
			const { addressPosition, ...sv } = c.streetView ?? {};
			map.setStreetView(
				new google.maps.StreetViewPanorama(el, {
					addressControlOptions: {
						position: google.maps.ControlPosition[addressPosition ?? "BOTTOM_CENTER"],
					},
					linksControl: true,
					panControl: true,
					enableCloseButton: true,
					...sv,
					visible: false,
				}),
			);
		}

		if (c.transparentBackground) {
			const inner = el.firstElementChild as HTMLElement | null;
			if (inner) {
				inner.style.backgroundColor = "transparent";
			}
		}

		this.attribution(map, tiles);
		map.addListener("maptypeid_changed", () => {
			this.config.onMapTypeChange?.(map, String(map.getMapTypeId() ?? ""), key);
		});

		const instance: KnMapInstance = {
			key,
			el,
			map,
		};
		c.onCreate?.(instance);
		return instance;
	}

	/** Attribution of the custom tile layers (displayed when the layer is active) */
	private attribution(map: google.maps.Map, tiles: readonly KnTileLayer[]): void {
		if (!tiles.some((t) => t.attribution)) {
			return;
		}
		const div = document.createElement("div");
		div.className = "kn-gmap-attribution";
		Object.assign(div.style, {
			background: "rgba(255,255,255,0.7)",
			color: "#444",
			font: "10px Roboto, Arial, sans-serif",
			padding: "0 6px",
			marginBottom: "2px",
			display: "none",
		});
		map.controls[google.maps.ControlPosition.BOTTOM_RIGHT]?.push(div);

		const update = () => {
			const t = tiles.find((l) => l.id === map.getMapTypeId());
			div.textContent = t?.attribution ?? "";
			div.style.display = t?.attribution ? "block" : "none";
		};
		map.addListener("maptypeid_changed", update);
		update();
	}
}

/** Global maps manager */
export const KnMaps: KnMapManager = new KnMapManager();
