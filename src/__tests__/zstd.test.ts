import { decompressZstd } from "@/utils/zstd";

// A real zstd frame generated once via the `zstd` CLI (v1.5.7), embedded base64
// so the test is portable (fzstd is decompress-only). Round-trips to PLAINTEXT.
const ZSTD_BASE64 =
  "KLUv/QRYMQIARGVja3MgenN0ZCByb3VuZC10cmlwIGZpeHR1cmUg4oCUIGNvbGxlY3Rpb24gYnl0ZXMgc3RhbmQtaW4gMDEyMzQ1Njc4OS4CrxE=";
const PLAINTEXT = "Decks zstd round-trip fixture — collection bytes stand-in 0123456789";

describe("decompressZstd", () => {
  it("decompresses a zstd frame to its original bytes", () => {
    const compressed = Uint8Array.from(Buffer.from(ZSTD_BASE64, "base64"));
    const out = decompressZstd(compressed);
    expect(new TextDecoder().decode(out)).toBe(PLAINTEXT);
  });
});
