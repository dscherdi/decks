module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: {
    browser: true,
    es6: true,
    node: true,
  },
  overrides: [
    {
      files: ["*.svelte"],
      parser: "svelte-eslint-parser",
      parserOptions: {
        parser: "@typescript-eslint/parser",
        extraFileExtensions: [".svelte"],
      },
      plugins: ["svelte"],
      extends: ["plugin:svelte/recommended"],
    },
    {
      files: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/__tests__/**",
        "**/__mocks__/**",
      ],
      env: {
        jest: true,
      },
    },
  ],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-inferrable-types": "error",
    "prefer-const": "error",
  },
  ignorePatterns: ["dist/", "node_modules/", "*.js", "*.mjs"],
};
