import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
	test: {
		alias: {
			// The real "obsidian" package is types-only; tests load a stub.
			obsidian: fileURLToPath(new URL("./src/test/obsidianStub.ts", import.meta.url)),
		},
	},
});
