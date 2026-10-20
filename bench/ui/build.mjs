import esbuild from "esbuild";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../..");

const inlineWorkerPlugin = {
	name: "inline-worker",
	setup(build) {
		build.onResolve({ filter: /^worker:/ }, (args) => ({
			path: new URL(`${args.path.slice("worker:".length)}.ts`, `file://${args.resolveDir}/`).pathname,
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
			});
			return {
				contents: `export default ${JSON.stringify(result.outputFiles[0].text)};`,
				loader: "js",
			};
		});
	},
};

await esbuild.build({
	entryPoints: [path.join(directory, "app.ts")],
	bundle: true,
	format: "iife",
	platform: "browser",
	target: "es2022",
	outfile: path.join(directory, "bundle.js"),
	alias: { obsidian: path.join(directory, "obsidianAdapter.ts") },
	plugins: [inlineWorkerPlugin],
});

const [pluginCss, harnessCss] = await Promise.all([
	readFile(path.join(root, "styles.css"), "utf8"),
	readFile(path.join(directory, "harness.css"), "utf8"),
]);
const bundlePath = path.join(directory, "bundle.js");
await Promise.all([
	rm(`${bundlePath}.map`, { force: true }),
	writeFile(path.join(directory, "bundle.css"), `${harnessCss}\n${pluginCss}\n`),
]);

console.log("UI harness built: bench/ui/index.html");
