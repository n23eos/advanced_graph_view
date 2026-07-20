import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const banner = `/*
Graph Insight — advanced graph view for Obsidian.
This file is bundled from TypeScript sources. See the GitHub repository.
*/
`;

const isProduction = process.argv[2] === "production";

/**
 * Imports matching "*.worker.ts" are bundled separately and imported
 * as a plain JS string, so the plugin ships as a single main.js and
 * spawns workers at runtime via Blob URLs.
 */
const inlineWorkerPlugin = {
	name: "inline-worker",
	setup(build) {
		build.onResolve({ filter: /^worker:/ }, (args) => ({
			path: new URL(args.path.slice("worker:".length) + ".ts", `file://${args.resolveDir}/`).pathname,
			namespace: "inline-worker",
		}));
		build.onLoad({ filter: /.*/, namespace: "inline-worker" }, async (args) => {
			const result = await esbuild.build({
				entryPoints: [args.path],
				bundle: true,
				write: false,
				format: "iife",
				platform: "browser",
				target: "es2022",
				minify: isProduction,
			});
			return {
				contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
				loader: "js",
			};
		});
	},
};

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
	],
	format: "cjs",
	target: "es2022",
	logLevel: "info",
	sourcemap: isProduction ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	banner: { js: banner },
	minify: isProduction,
	plugins: [inlineWorkerPlugin],
});

if (isProduction) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
