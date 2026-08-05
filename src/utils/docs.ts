// Base URL for the hosted documentation site. Single source of truth so the
// in-app help links are trivial to repoint.
export const DOCS_BASE_URL = "https://decksmd.app";

// Build a documentation page URL from a page path, e.g. docUrl("reviewing/sessions").
export function docUrl(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return `${DOCS_BASE_URL}/docs/${clean}/`;
}
