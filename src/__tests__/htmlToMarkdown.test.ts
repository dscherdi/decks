import { htmlToMarkdown } from "../utils/htmlToMarkdown";

// turndown ships its own DOM (domino) so this runs in the node test env too.
describe("htmlToMarkdown (turndown)", () => {
  it("converts inline and list HTML to markdown", () => {
    expect(htmlToMarkdown("<b>bold</b>")).toContain("**bold**");
    expect(htmlToMarkdown("<ul><li>a</li><li>b</li></ul>")).toMatch(/-\s+a/);
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

  it("keeps HTML that markdown can't express (sub/sup/table)", () => {
    expect(htmlToMarkdown("H<sub>2</sub>O")).toContain("<sub>2</sub>");
    expect(htmlToMarkdown("x<sup>2</sup>")).toContain("<sup>2</sup>");
    expect(htmlToMarkdown("<table><tr><td>a</td></tr></table>")).toContain("<td>a</td>");
  });

  it("keeps colored spans but unwraps plain ones", () => {
    expect(htmlToMarkdown('<span style="color: red">hot</span>')).toContain('<span style="color: red">hot</span>');
    expect(htmlToMarkdown('<span style="font-family: arial">plain</span>')).toBe("plain");
  });
});
