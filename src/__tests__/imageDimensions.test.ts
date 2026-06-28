import { imageDimensions } from "@/utils/imageDimensions";

// Minimal PNG: 8-byte signature + IHDR length/type + width/height (big-endian).
function png(width: number, height: number): Uint8Array {
  const b = new Uint8Array(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8); // length 13 + "IHDR"
  const u32 = (v: number, o: number): void => {
    b[o] = (v >>> 24) & 0xff;
    b[o + 1] = (v >>> 16) & 0xff;
    b[o + 2] = (v >>> 8) & 0xff;
    b[o + 3] = v & 0xff;
  };
  u32(width, 16);
  u32(height, 20);
  return b;
}

function gif(width: number, height: number): Uint8Array {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // GIF89a
  b[6] = width & 0xff;
  b[7] = (width >> 8) & 0xff;
  b[8] = height & 0xff;
  b[9] = (height >> 8) & 0xff;
  return b;
}

function svg(tag: string): Uint8Array {
  return new TextEncoder().encode(`<?xml version="1.0"?>\n${tag}<rect/></svg>`);
}

describe("imageDimensions", () => {
  it("reads PNG dimensions from the IHDR (incl. the small-render case)", () => {
    expect(imageDimensions(png(29, 26))).toEqual({ width: 29, height: 26 });
    expect(imageDimensions(png(1920, 1080))).toEqual({ width: 1920, height: 1080 });
  });

  it("reads GIF logical-screen dimensions", () => {
    expect(imageDimensions(gif(48, 32))).toEqual({ width: 48, height: 32 });
  });

  it("reads SVG width/height attributes (ignoring px units)", () => {
    expect(imageDimensions(svg('<svg width="120px" height="80px">'))).toEqual({
      width: 120,
      height: 80,
    });
  });

  it("falls back to the SVG viewBox when width/height are missing", () => {
    expect(imageDimensions(svg('<svg viewBox="0 0 200 150">'))).toEqual({
      width: 200,
      height: 150,
    });
  });

  it("returns undefined for unknown/too-short data", () => {
    expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeUndefined();
    expect(imageDimensions(new TextEncoder().encode("just text"))).toBeUndefined();
  });
});
