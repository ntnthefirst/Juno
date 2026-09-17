import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["dist/**", "dist-electron/**", "release/**", "node_modules/**", ".smoke/**"],
	},

	// Renderer
	{
		files: ["src/**/*.{ts,tsx}"],
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		languageOptions: {
			ecmaVersion: 2023,
			globals: globals.browser,
		},
		plugins: {
			"react-hooks": reactHooks,
			"react-refresh": reactRefresh,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			"react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
			// A node-only module reaching the renderer works in dev and ships broken.
			// See .claude/rules/verify.md.
			"no-restricted-imports": [
				"error",
				{
					paths: [
						{ name: "electron", message: "The renderer talks to the main process through window.bureau." },
						{ name: "node:fs", message: "The renderer has no filesystem." },
						{ name: "node:path", message: "The renderer has no filesystem." },
						{ name: "node:sqlite", message: "The renderer never sees the database." },
					],
				},
			],
		},
	},

	// Main process and preload
	{
		files: ["electron/**/*.ts"],
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		languageOptions: {
			ecmaVersion: 2023,
			globals: globals.node,
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "error",
		},
	},

	// Build scripts
	{
		files: ["scripts/**/*.mjs", "*.config.{ts,js}"],
		extends: [js.configs.recommended],
		languageOptions: {
			ecmaVersion: 2023,
			sourceType: "module",
			globals: globals.node,
		},
	},
);
