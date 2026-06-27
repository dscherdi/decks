import { strToU8 } from "fflate";
import { pickAnkiCollection } from "@/utils/ankiCollection";

// A real zstd frame (CLI-generated, base64) decoding to PLAINTEXT — proves the
// anki21b branch actually decompresses. Shared with zstd.test.ts.
const ZSTD_BASE64 =
  "KLUv/QRYMQIARGVja3MgenN0ZCByb3VuZC10cmlwIGZpeHR1cmUg4oCUIGNvbGxlY3Rpb24gYnl0ZXMgc3RhbmQtaW4gMDEyMzQ1Njc4OS4CrxE=";
const PLAINTEXT = "Decks zstd round-trip fixture — collection bytes stand-in 0123456789";

function zstd(): Uint8Array {
  return Uint8Array.from(Buffer.from(ZSTD_BASE64, "base64"));
}
function decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

describe("pickAnkiCollection", () => {
  it("prefers (and decompresses) collection.anki21b over a legacy anki2 stub", () => {
    const entries = {
      "collection.anki2": strToU8("legacy stub — please update"),
      "collection.anki21b": zstd(),
    };
    expect(decode(pickAnkiCollection(entries))).toBe(PLAINTEXT);
  });

  it("prefers anki21b over both anki21 and anki2", () => {
    const entries = {
      "collection.anki2": strToU8("stub2"),
      "collection.anki21": strToU8("stub21"),
      "collection.anki21b": zstd(),
    };
    expect(decode(pickAnkiCollection(entries))).toBe(PLAINTEXT);
  });

  it("falls back to anki21 then anki2 when anki21b is absent", () => {
    expect(decode(pickAnkiCollection({ "collection.anki21": strToU8("A"), "collection.anki2": strToU8("B") }))).toBe("A");
    expect(decode(pickAnkiCollection({ "collection.anki2": strToU8("B") }))).toBe("B");
  });

  it("throws when no collection is present", () => {
    expect(() => pickAnkiCollection({ media: strToU8("{}") })).toThrow(/No Anki collection/);
  });
});
