import { readFileSync } from "node:fs";
import { defineConfig, type UserConfigExport } from "vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
	version: string;
	author: string;
};

const banner = `/*!
 * KnGmapClusterer v${pkg.version}
 * Copyright (c) 2021 - ${new Date().getFullYear()} ${pkg.author}
 * Released under the MIT license
 */`;

/**
 * - `vite`: dev server of the examples (index.html + examples/)
 * - `vite build`: ESM library (index + vue entries)
 * - `vite build --mode umd`: minified UMD bundle (global KnGmapClusterer) for <script> / CDN
 */
const config: UserConfigExport = defineConfig(({ mode, command }) => {
	const umd = mode === "umd";

	return {
		// examples: Vue build with the template compiler (templates in strings)
		...(command === "serve"
			? {
					resolve: {
						alias: {
							vue: "vue/dist/vue.esm-bundler.js",
						},
					},
					define: {
						__VUE_OPTIONS_API__: "true",
						__VUE_PROD_DEVTOOLS__: "false",
						__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
					},
				}
			: {}),
		server: {
			open: "/index.html",
		},
		build: {
			target: "es2022",
			emptyOutDir: !umd,
			copyPublicDir: false,
			sourcemap: true,
			minify: umd,
			lib: umd
				? {
						entry: "src/index.ts",
						name: "KnGmapClusterer",
						formats: [
							"umd",
						],
						fileName: () => "kn-gmap-clusterer.umd.js",
					}
				: {
						entry: {
							index: "src/index.ts",
							vue: "src/vue/index.ts",
						},
						formats: [
							"es",
						],
						fileName: (_format, name) => `${name}.js`,
					},
			rolldownOptions: {
				external: [
					"vue",
				],
				output: {
					banner,
					chunkFileNames: "kn-gmap-clusterer-[hash].js",
				},
			},
		},
	};
});

export default config;
