import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import sveltePlugin from "eslint-plugin-svelte";
import svelteParser from "svelte-eslint-parser";
import obsidianPlugin from "eslint-plugin-obsidianmd";
import eslintCommentsPlugin from "@eslint-community/eslint-plugin-eslint-comments";
import globals from "globals";

export default [
  // Base JavaScript configuration
  js.configs.recommended,

  // Global ignores (replaces .eslintignore)
  {
    ignores: [
      "dist/",
      "node_modules/",
      "benchmark/",
      "**/__tests__/**",
      "**/__mocks__/**",
      "**/*.test.ts",
      "**/*.spec.ts",
      // Node/jest bootstrap that polyfills window from the Node global.
      "src/test-setup.ts",
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
        // Obsidian-injected globals (popout-window compatibility).
        activeDocument: "readonly",
        activeWindow: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      obsidianmd: obsidianPlugin,
      "@eslint-community/eslint-comments": eslintCommentsPlugin,
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
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/no-redundant-type-constituents": "error",
      "prefer-const": "error",
      // Promise/async rules
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/require-await": "warn",
      // Template literal rules
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        {
          allowNumber: true,
          allowBoolean: true,
          allowAny: false,
          allowNullish: true,
          allowRegExp: false,
        },
      ],
      // ESLint comment rules - prevent disabling no-explicit-any
      "@eslint-community/eslint-comments/no-use": [
        "error",
        {
          allow: [
            "eslint-disable-next-line",
            "eslint-disable",
            "eslint-enable",
            "global",
          ],
        },
      ],
      "@eslint-community/eslint-comments/no-restricted-disable": [
        "error",
        "@typescript-eslint/no-explicit-any",
      ],
      // Every eslint-disable directive must explain why (matches the Obsidian
      // plugin validator's stricter check).
      "@eslint-community/eslint-comments/require-description": [
        "error",
        { ignore: [] },
      ],
      // Obsidian plugin rules
      "obsidianmd/hardcoded-config-path": "error",
      "obsidianmd/no-forbidden-elements": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      // Popout-window compatibility (matches the Obsidian plugin reviewer).
      "obsidianmd/no-global-this": "error",
      "obsidianmd/prefer-active-doc": "error",
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
        // Obsidian-injected globals (popout-window compatibility).
        activeDocument: "readonly",
        activeWindow: "readonly",
      },
    },
    plugins: {
      svelte: sveltePlugin,
      "@typescript-eslint": tsPlugin,
      obsidianmd: obsidianPlugin,
      "@eslint-community/eslint-comments": eslintCommentsPlugin,
    },
    rules: {
      ...sveltePlugin.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      // Disabled for .svelte: @typescript-eslint/no-unused-vars crashes the
      // svelte-eslint-parser on some constructs (reactive declarations,
      // computed-key destructuring). svelte-check already reports unused vars.
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-inferrable-types": "error",
      "prefer-const": "error",
      // Promise/async rules - disabled for Svelte due to parser limitations
      // These should be checked manually in Svelte files
      // ESLint comment rules - prevent disabling no-explicit-any
      "@eslint-community/eslint-comments/no-use": [
        "error",
        {
          allow: [
            "eslint-disable-next-line",
            "eslint-disable",
            "eslint-enable",
            "global",
          ],
        },
      ],
      "@eslint-community/eslint-comments/no-restricted-disable": [
        "error",
        "@typescript-eslint/no-explicit-any",
      ],
      // Every eslint-disable directive must explain why (matches the Obsidian
      // plugin validator's stricter check).
      "@eslint-community/eslint-comments/require-description": [
        "error",
        { ignore: [] },
      ],
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
