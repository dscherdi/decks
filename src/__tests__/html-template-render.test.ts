import { embedWikiImages } from "../utils/html-template-render";

// Stub resolver: pretend every linkpath resolves to an app:// resource URL.
const resolve = (lp: string) => `app://vault/${lp}`;

describe("embedWikiImages", () => {
  it("converts a wikilink image embed to a native <img>", () => {
    expect(embedWikiImages("<p>![[cornea.png]]</p>", resolve)).toBe(
      '<p><img src="app://vault/cornea.png" alt="cornea.png"></p>'
    );
  });

  it("parses |width and |WxH options", () => {
    expect(embedWikiImages("![[a.png|200]]", resolve)).toBe(
      '<img src="app://vault/a.png" alt="a.png" width="200">'
    );
    expect(embedWikiImages("![[a.png|200x100]]", resolve)).toBe(
      '<img src="app://vault/a.png" alt="a.png" width="200" height="100">'
    );
  });

  it("treats a non-numeric option as alt text (escaped)", () => {
    expect(embedWikiImages('![[a.png|a "b"]]', resolve)).toBe(
      '<img src="app://vault/a.png" alt="a &quot;b&quot;">'
    );
  });

  it("converts a local markdown image embed", () => {
    expect(embedWikiImages("![Eye](retina.png)", resolve)).toBe(
      '<img src="app://vault/retina.png" alt="Eye">'
    );
  });

  it("converts external (internet) image links, with or without an extension", () => {
    expect(embedWikiImages("![x](https://e.com/a.png)", resolve)).toBe(
      '<img src="https://e.com/a.png" alt="x">'
    );
    // No file extension — the `!` already declares it an image.
    expect(embedWikiImages("![cornea](https://e.com/scassets/cornea)", resolve)).toBe(
      '<img src="https://e.com/scassets/cornea" alt="cornea">'
    );
    expect(embedWikiImages("![[https://e.com/a.png]]", resolve)).toBe(
      '<img src="https://e.com/a.png" alt="https://e.com/a.png">'
    );
  });

  it("leaves non-image vault embeds and unresolved paths untouched", () => {
    expect(embedWikiImages("![[Some Note]]", resolve)).toBe("![[Some Note]]");
    expect(embedWikiImages("![[gone.png]]", () => null)).toBe("![[gone.png]]");
  });
});
