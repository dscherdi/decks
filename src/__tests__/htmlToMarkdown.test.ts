import { htmlToMarkdown } from "../utils/htmlToMarkdown";

// turndown needs a DOM. The default jest env is node, so this suite only runs
// where a `document` exists (e.g. a jsdom env); otherwise it is skipped.
const hasDom = typeof document !== "undefined";
const describeIfDom = hasDom ? describe : describe.skip;

describeIfDom("htmlToMarkdown (turndown)", () => {
  it("converts inline and list HTML to markdown", () => {
    expect(htmlToMarkdown("<b>bold</b>")).toContain("**bold**");
    expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toContain("- a");
    expect(htmlToMarkdown('<a href="https://x.com">link</a>')).toContain("[link](https://x.com)");
  });

  it("drops style/script blocks", () => {
    expect(htmlToMarkdown("<style>.x{}</style>Hello")).toBe("Hello");
  });

  it("leaves Decks markdown tokens unescaped", () => {
    expect(htmlToMarkdown("![[a.mp3]]")).toBe("![[a.mp3]]");
    expect(htmlToMarkdown("==answer==")).toBe("==answer==");
    expect(htmlToMarkdown("$x^2$")).toBe("$x^2$");
  });
});
