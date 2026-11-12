/** The backing buffer when the view spans it exactly, a copy otherwise. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const { buffer, byteOffset, byteLength } = bytes;
  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }
  const copy = new ArrayBuffer(byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** What to hand over with a message so `bytes` moves to the other side instead of being copied. */
export function transferOf(bytes: Uint8Array): Transferable[] {
  return bytes.buffer instanceof ArrayBuffer ? [bytes.buffer] : [];
}
