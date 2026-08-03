import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
	// The same checks the community-plugin review runs, so a failed submission
	// shows up here rather than in someone else's report.
	...obsidianmd.configs.recommended,
	{
		// Some of those rules need type information to run.
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsParser,
			parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
		},
	},
	{
		files: ["src/**/*.ts"],
		// Benchmarks build their own standalone page and never enter main.js,
		// so Obsidian's plugin API rules (createEl, window timers) do not apply.
		ignores: ["src/bench/**"],
		languageOptions: {
			parser: tsParser,
			parserOptions: { sourceType: "module" },
		},
		plugins: { "@typescript-eslint": tsPlugin },
		rules: {
			...tsPlugin.configs.recommended.rules,
			"no-var": "error",
			"prefer-const": "error",
			"@typescript-eslint/no-unused-vars": ["error", { args: "none" }],
			"@typescript-eslint/no-explicit-any": "warn",
		},
	},
	{
		// This module is the body of a Web Worker: `window` does not exist in
		// that scope, so the popout-window timer rule would break it.
		files: ["src/workers/layoutEngine.ts"],
		rules: { "obsidianmd/prefer-window-timers": "off" },
	},
	{
		files: ["src/bench/**/*.ts"],
		rules: { "obsidianmd/prefer-create-el": "off" },
	},
];
