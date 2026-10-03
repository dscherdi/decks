import type { App } from "obsidian";
import { ConfirmModal } from "../components/ConfirmModal";

// Callers wrap onClose to read a dismissal as a cancel, so the confirmation has to land first.
describe("the confirm dialog", () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "activeDocument");
  beforeAll(() => {
    Object.assign(globalThis, { activeDocument: { createElement: () => ({}) } });
  });
  afterAll(() => {
    if (saved) Object.defineProperty(globalThis, "activeDocument", saved);
    else Reflect.deleteProperty(globalThis, "activeDocument");
  });

  it("confirms before it closes", () => {
    const order: string[] = [];
    const modal = new ConfirmModal({} as unknown as App, {
      title: "Reset",
      message: "Reset this card?",
      onConfirm: () => order.push("confirm"),
    });
    modal.onClose = () => {
      order.push("close");
    };
    modal.close = () => modal.onClose();
    modal.confirm();
    expect(order).toEqual(["confirm", "close"]);
  });
});
