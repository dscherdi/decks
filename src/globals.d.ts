/**
 * Build-time flag injected by esbuild (`define` in esbuild.config.mjs).
 * `true` for `npm run build:dev`, `false` for the production build — where the
 * literal `false` lets tree shaking drop any code guarded by it, so
 * development-only UI is absent from the released bundle rather than hidden.
 */
declare const __DECKS_DEV__: boolean;
