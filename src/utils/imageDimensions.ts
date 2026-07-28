/**
 * Read an image's intrinsic pixel size from its bytes — PNG, GIF, JPEG, and SVG.
 * Used so imported Anki image embeds can carry a width hint (`![[name|width]]`),
 * keeping small images from being scaled up to fill a table cell. Returns
 * `undefined` for unsupported/unreadable formats.
 */
export interface ImageSize {
  width: number;
  height: number;
}

export function imageDimensions(bytes: Uint8Array): ImageSize | undefined {
  if (!bytes || bytes.length < 4) return undefined;
  return pngSize(bytes) ?? gifSize(bytes) ?? jpegSize(bytes) ?? svgSize(bytes);
}

function readU32BE(b: Uint8Array, o: number): number {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

function ok(width: number, height: number): ImageSize | undefined {
  return width > 0 && height > 0 ? { width, height } : undefined;
}

// PNG: 8-byte signature, then the IHDR chunk with width@16, height@20 (big-endian).
function pngSize(b: Uint8Array): ImageSize | undefined {
  if (b.length < 24) return undefined;
  if (b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47) return undefined;
  return ok(readU32BE(b, 16), readU32BE(b, 20));
}

// GIF: "GIF8", then logical-screen width/height (little-endian) at offset 6/8.
function gifSize(b: Uint8Array): ImageSize | undefined {
  if (b.length < 10) return undefined;
  if (b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46 || b[3] !== 0x38) return undefined;
  return ok(b[6] | (b[7] << 8), b[8] | (b[9] << 8));
}

// JPEG: scan segments for a Start-Of-Frame marker; height/width follow at +5/+7.
function jpegSize(b: Uint8Array): ImageSize | undefined {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return undefined;
  let off = 2;
  while (off + 9 < b.length) {
    if (b[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = b[off + 1];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return ok((b[off + 7] << 8) | b[off + 8], (b[off + 5] << 8) | b[off + 6]);
    }
    const len = (b[off + 2] << 8) | b[off + 3];
    if (len < 2) return undefined;
    off += 2 + len;
  }
  return undefined;
}

// SVG: read width/height from the opening tag, else fall back to the viewBox.
function svgSize(b: Uint8Array): ImageSize | undefined {
  const head = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 4096)));
  const match = /<svg\b[^>]*>/i.exec(head);
  if (!match) return undefined;
  const tag = match[0];
  const w = svgLength(tag, "width");
  const h = svgLength(tag, "height");
  if (w && h) return ok(w, h);
  const vb = /\bviewBox\s*=\s*["']?\s*[-\d.]+\s+[-\d.]+\s+([-\d.]+)\s+([-\d.]+)/i.exec(tag);
  if (vb) return ok(Math.round(Number(vb[1])), Math.round(Number(vb[2])));
  return undefined;
}

function svgLength(tag: string, attr: string): number | undefined {
  const m = new RegExp(`\\b${attr}\\s*=\\s*["']?\\s*([\\d.]+)\\s*(?:px|pt)?`, "i").exec(tag);
  if (!m) return undefined;
  const n = Math.round(Number(m[1]));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
