import type { SvelteComponent } from "svelte";

declare module "*.svelte" {
  const component: typeof SvelteComponent;
  export default component;
}
