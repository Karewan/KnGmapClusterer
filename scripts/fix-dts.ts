/**
 * Rewrite the relative ".ts" imports of the emitted declarations into ".js"
 * (TypeScript only rewrites them in the JavaScript output).
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function walk(dir: string): string[] {
	return readdirSync(dir).flatMap((f) => {
		const p = join(dir, f);
		return statSync(p).isDirectory()
			? walk(p)
			: p.endsWith(".d.ts")
				? [
						p,
					]
				: [];
	});
}

let count = 0;
for (const file of walk("dist/types")) {
	const src = readFileSync(file, "utf8");
	const out = src.replace(/(from\s+["']|import\(["'])(\.{1,2}\/[^"']+)\.ts(["'])/g, "$1$2.js$3");
	if (out !== src) {
		writeFileSync(file, out);
		count++;
	}
}
console.log(`fix-dts: ${count} declaration files rewritten`);
