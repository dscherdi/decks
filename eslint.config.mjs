import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import obsidianPlugin from "eslint-plugin-obsidianmd";
import globals from "globals";

export default [
  // Base JavaScript configuration
  js.configs.recommended,

  // Global ignores (replaces .eslintignore)
  {
    ignores: [
      "dist/",
      "node_modules/",
      "**/__tests__/**",
      "**/__mocks__/**",
      "**/*.test.ts",
      "**/*.spec.ts",
      "*.config.js",
      "*.config.mjs",
      "esbuild.config.mjs",
      "jest.config.js",
      "svelte.config.js",
      "version-bump.mjs",
      "scripts/",
    ],
  },

  // TypeScript configuration
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { project: "./tsconfig.json" },
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
        NodeJS: "readonly",
        Transferable: "readonly",
        FrameRequestCallback: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      obsidianmd: obsidianPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...obsidianPlugin.configs.recommended,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-inferrable-types": "error",
      "prefer-const": "error",
      // Obsidian plugin rules
      "obsidianmd/hardcoded-config-path": "error",
      "obsidianmd/no-forbidden-elements": "error",
      "obsidianmd/no-static-styles-assignment": "error",
    },
  },

  // Svelte configuration
  {
    files: ["**/*.svelte"],
    languageOptions: {
      parser: svelteParser,
      parserOptions: {
        parser: tsParser,
        extraFileExtensions: [".svelte"],
        ecmaVersion: 2020,
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
      },
    },
    plugins: {
      svelte: sveltePlugin,
      "@typescript-eslint": tsPlugin,
      obsidianmd: obsidianPlugin,
    },
    rules: {
      ...sveltePlugin.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-inferrable-types": "error",
      "prefer-const": "error",
      // Obsidian plugin rules
      "obsidianmd/hardcoded-config-path": "error",
      "obsidianmd/no-forbidden-elements": "error",
      "obsidianmd/no-static-styles-assignment": "error",
    },
  },

  // Jest test files configuration
  {
    files: [
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/__tests__/**/*.ts",
      "**/__mocks__/**/*.ts",
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
      },
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-inferrable-types": "error",
      "prefer-const": "error",
    },
  },
];
