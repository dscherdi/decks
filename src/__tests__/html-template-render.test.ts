import { embedWikiMedia } from "../utils/html-template-render";

// Stub resolver: pretend every linkpath resolves to an app:// resource URL.
const resolve = (lp: string) => `app://vault/${lp}`;

describe("embedWikiMedia", () => {
  it("converts a wikilink image embed to a native <img>", () => {
    expect(embedWikiMedia("<p>![[cornea.png]]</p>", resolve)).toBe(
      '<p><img src="app://vault/cornea.png" alt="cornea.png"></p>'
    );
  });

  it("parses |width and |WxH options", () => {
    expect(embedWikiMedia("![[a.png|200]]", resolve)).toBe(
      '<img src="app://vault/a.png" alt="a.png" width="200">'
    );
    expect(embedWikiMedia("![[a.png|200x100]]", resolve)).toBe(
      '<img src="app://vault/a.png" alt="a.png" width="200" height="100">'
    );
  });

  it("treats a non-numeric option as alt text (escaped)", () => {
    expect(embedWikiMedia('![[a.png|a "b"]]', resolve)).toBe(
      '<img src="app://vault/a.png" alt="a &quot;b&quot;">'
    );
  });

  it("converts a local markdown image embed", () => {
    expect(embedWikiMedia("![Eye](retina.png)", resolve)).toBe(
      '<img src="app://vault/retina.png" alt="Eye">'
    );
  });

  it("converts external (internet) image links, with or without an extension", () => {
    expect(embedWikiMedia("![x](https://e.com/a.png)", resolve)).toBe(
      '<img src="https://e.com/a.png" alt="x">'
    );
    // No file extension — the `!` already declares it an image.
    expect(embedWikiMedia("![cornea](https://e.com/scassets/cornea)", resolve)).toBe(
      '<img src="https://e.com/scassets/cornea" alt="cornea">'
    );
    expect(embedWikiMedia("![[https://e.com/a.png]]", resolve)).toBe(
      '<img src="https://e.com/a.png" alt="https://e.com/a.png">'
    );
  });

  it("converts a wikilink audio embed to a native <audio> player", () => {
    expect(embedWikiMedia("<p>![[FR1K_1000_hebdomadaire_word.mp3]]</p>", resolve)).toBe(
      '<p><audio controls src="app://vault/FR1K_1000_hebdomadaire_word.mp3"></audio></p>'
    );
    // Other audio extensions resolve too.
    expect(embedWikiMedia("![[clip.ogg]]", resolve)).toBe(
      '<audio controls src="app://vault/clip.ogg"></audio>'
    );
  });

  it("converts a wikilink video embed to a native <video> player", () => {
    expect(embedWikiMedia("![[demo.mp4]]", resolve)).toBe(
      '<video controls src="app://vault/demo.mp4"></video>'
    );
  });

  it("converts a local markdown audio embed", () => {
    expect(embedWikiMedia("![sound](a.mp3)", resolve)).toBe(
      '<audio controls src="app://vault/a.mp3"></audio>'
    );
  });

  it("leaves note embeds, non-media paths, and unresolved media untouched", () => {
    expect(embedWikiMedia("![[Some Note]]", resolve)).toBe("![[Some Note]]");
    expect(embedWikiMedia("![[gone.png]]", () => null)).toBe("![[gone.png]]");
    // Audio that can't be resolved is left as literal text (no broken player).
    expect(embedWikiMedia("![[missing.mp3]]", () => null)).toBe("![[missing.mp3]]");
  });
});
