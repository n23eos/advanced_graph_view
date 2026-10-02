import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	resolve: {
		alias: [
			{
				// The real "obsidian" package is types-only; tests load a stub.
				find: "obsidian",
				replacement: fileURLToPath(new URL("./src/test/obsidianStub.ts", import.meta.url)),
			},
			{
				find: /^worker:.*$/,
				replacement: fileURLToPath(new URL("./src/test/workerSourceStub.ts", import.meta.url)),
			},
		],
	},
});
