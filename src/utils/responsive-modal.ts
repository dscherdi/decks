import type { Modal } from "obsidian";

const MOBILE_MAX_WIDTH = 768;

export interface ResponsiveModalHandle {
  dispose(): void;
}

/**
 * Apply the shared Decks modal sizing/mobile classes and keep
 * `decks-modal-mobile` in sync with the viewport. Call in `onOpen` and
 * `dispose()` the handle in `onClose`. Pass any modal-specific classes
 * (e.g. "decks-exam-modal") as `extraClasses`.
 */
export function makeModalResponsive(
  modal: Modal,
  extraClasses: string[] = []
): ResponsiveModalHandle {
  const sync = () => {
    const modalEl = modal.containerEl.querySelector(".modal");
    if (!(modalEl instanceof HTMLElement)) return;
    modalEl.addClass("decks-modal");
    for (const cls of extraClasses) modalEl.addClass(cls);
    if (window.innerWidth <= MOBILE_MAX_WIDTH) {
      modalEl.addClass("decks-modal-mobile");
    } else {
      modalEl.removeClass("decks-modal-mobile");
    }
  };
  sync();
  window.addEventListener("resize", sync);
  return {
    dispose() {
      window.removeEventListener("resize", sync);
    },
  };
}
