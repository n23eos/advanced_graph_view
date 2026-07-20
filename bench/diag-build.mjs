import esbuild from "esbuild";
const inlineWorkerPlugin = {
	name: "inline-worker",
	setup(build) {
		build.onResolve({ filter: /^worker:/ }, (args) => ({
			path: new URL(args.path.slice(7) + ".ts", `file://${args.resolveDir}/`).pathname,
			namespace: "inline-worker",
		}));
		build.onLoad({ filter: /.*/, namespace: "inline-worker" }, async (args) => {
			const r = await esbuild.build({ entryPoints: [args.path], bundle: true, write: false, format: "iife", platform: "browser", target: "es2022" });
			return { contents: `export default ${JSON.stringify(r.outputFiles[0].text)};`, loader: "js" };
		});
	},
};
await esbuild.build({ entryPoints: ["bench/diag.ts"], bundle: true, format: "iife", target: "es2022", outfile: "bench/diag.js", plugins: [inlineWorkerPlugin] });
console.log("diag built");
