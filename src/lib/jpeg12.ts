// 12-bit baseline JPEG decoder backed by libjpeg-turbo WASM (Cornerstone build).
// Decodes the PGR camera plane payloads (which are 12-bit baseline JPEG, not
// supported by any browser image decoder) into an 8-bit grayscale dataURL so
// the FramePreview can render the actual road surface.

// @ts-expect-error - JS module from cornerstone has no types
import libjpegturbo12wasm from "@cornerstonejs/codec-libjpeg-turbo-12bit/dist/libjpegturbo12wasm.js";
import wasmUrl from "@cornerstonejs/codec-libjpeg-turbo-12bit/dist/libjpegturbo12wasm.wasm?url";

let modulePromise: Promise<any> | undefined;

function getModule(): Promise<any> {
  if (!modulePromise) {
    modulePromise = libjpegturbo12wasm({
      locateFile: (p: string) => (p.endsWith(".wasm") ? wasmUrl : p),
    });
  }
  return modulePromise!;
}

export interface DecodedPlane {
  width: number;
  height: number;
  bitsPerSample: number;
  componentCount: number;
  /** 16-bit grayscale samples for 12-bit input, 8-bit for 8-bit input. */
  pixels: Uint16Array | Uint8Array;
}

export async function decodeJpegBuffer(buf: Uint8Array): Promise<DecodedPlane | null> {
  try {
    const mod = await getModule();
    const decoder = new mod.JPEGDecoder();
    try {
      const enc = decoder.getEncodedBuffer(buf.length);
      enc.set(buf);
      decoder.decode();
      const info = decoder.getFrameInfo();
      const decoded: Uint8Array = decoder.getDecodedBuffer();
      // Copy out before delete()
      const copy = new Uint8Array(decoded.length);
      copy.set(decoded);
      const pixels =
        info.bitsPerSample > 8
          ? new Uint16Array(copy.buffer, copy.byteOffset, copy.byteLength / 2)
          : copy;
      return {
        width: info.width,
        height: info.height,
        bitsPerSample: info.bitsPerSample,
        componentCount: info.componentCount,
        pixels,
      };
    } finally {
      decoder.delete();
    }
  } catch {
    return null;
  }
}

/**
 * Decode a JPEG plane (8-bit or 12-bit baseline) and render it as a
 * contrast-stretched grayscale JPEG dataURL suitable for an <img> tag.
 */
export async function decodePlaneToDataUrl(buf: Uint8Array): Promise<string | null> {
  const frame = await decodeJpegBuffer(buf);
  if (!frame) return null;
  const { width: w, height: h, pixels, componentCount } = frame;
  if (!w || !h) return null;

  // Auto-levels using a fast sub-sample (every Nth pixel) for stretch range.
  const step = Math.max(1, Math.floor((w * h) / 50_000));
  let lo = Infinity;
  let hi = -Infinity;
  const sampleStride = step * componentCount;
  for (let i = 0; i < pixels.length; i += sampleStride) {
    const v = pixels[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) {
    lo = 0;
    hi = frame.bitsPerSample > 8 ? 4095 : 255;
  }
  const range = hi - lo;
  const gamma = 0.85;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(w, h);
  const px = img.data;

  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const src = pixels[i * componentCount];
    let n = (src - lo) / range;
    if (n < 0) n = 0;
    else if (n > 1) n = 1;
    const v = Math.pow(n, gamma) * 255;
    px[p] = px[p + 1] = px[p + 2] = v;
    px[p + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL("image/jpeg", 0.85);
}
