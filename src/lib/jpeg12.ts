// PGR road-image decoding utilities.
//
// Ladybug/PGR streams store each camera as four Bayer JPEG planes
// (R, G1, G2, B). Browser <img> can show some 8-bit JPEGs, but PGR survey
// files commonly use 12-bit baseline JPEG, which needs a WASM decoder.
// This module returns canvas-ready ImageData and falls back to the browser
// decoder for regular 8-bit JPEGs.

// @ts-expect-error - JS module from cornerstone has no types
import libjpegturbo12wasm from "@cornerstonejs/codec-libjpeg-turbo-12bit/dist/libjpegturbo12wasm.js";
import wasmUrl from "@cornerstonejs/codec-libjpeg-turbo-12bit/dist/libjpegturbo12wasm.wasm?url";

let modulePromise: Promise<any> | undefined;

function getModule(): Promise<any> {
  if (!modulePromise) {
    modulePromise = libjpegturbo12wasm({
      locateFile: (p: string) => (p.endsWith(".wasm") ? wasmUrl : p),
      printErr: () => undefined,
    });
  }
  return modulePromise;
}

export interface DecodedPlane {
  width: number;
  height: number;
  bitsPerSample: number;
  componentCount: number;
  pixels: Uint16Array | Uint8Array;
}

export interface DecodeResult {
  ok: boolean;
  url: string | null;
  width?: number;
  height?: number;
  error?: string;
}

export interface CameraDecodeResult extends DecodeResult {
  sourceCount: number;
}

function jpegPrecision(buf: Uint8Array): number | null {
  let i = 0;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    while (buf[i] === 0xff) i++;
    const marker = buf[i++];
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    const len = (buf[i] << 8) | buf[i + 1];
    if (len < 2 || i + len > buf.length) return null;
    // SOF0/SOF1/SOF2/SOF3 and SOF5/SOF6/SOF7 carry precision at segment byte 2.
    if (
      marker === 0xc0 ||
      marker === 0xc1 ||
      marker === 0xc2 ||
      marker === 0xc3 ||
      marker === 0xc5 ||
      marker === 0xc6 ||
      marker === 0xc7
    ) {
      return buf[i + 2];
    }
    i += len;
  }
  return null;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "object" && e && "message" in e) return String((e as { message: unknown }).message);
  return String(e || "decode failed");
}

async function decodeBrowserJpeg(buf: Uint8Array): Promise<DecodedPlane> {
  const blob = new Blob([buf], { type: "image/jpeg" });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const rgba = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
    const gray = new Uint8Array(bitmap.width * bitmap.height);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      gray[i] = Math.round(rgba[p] * 0.299 + rgba[p + 1] * 0.587 + rgba[p + 2] * 0.114);
    }
    return {
      width: bitmap.width,
      height: bitmap.height,
      bitsPerSample: 8,
      componentCount: 1,
      pixels: gray,
    };
  } finally {
    bitmap.close();
  }
}

export async function decodeJpegBuffer(buf: Uint8Array): Promise<DecodedPlane> {
  const precision = jpegPrecision(buf);
  if (precision !== null && precision <= 8) return decodeBrowserJpeg(buf);

  const mod = await getModule();
  const decoder = new mod.JPEGDecoder();
  try {
    const enc: Uint8Array = decoder.getEncodedBuffer(buf.length);
    enc.set(buf);
    decoder.decode();
    const info = decoder.getFrameInfo();
    const decoded: Uint8Array | Uint8ClampedArray | Int16Array | Uint16Array = decoder.getDecodedBuffer();
    const bytes = new Uint8Array(decoded.byteLength);
    bytes.set(new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength));
    return {
      width: Number(info.width),
      height: Number(info.height),
      // The Cornerstone 12-bit wrapper reports an 8-bit display path but returns
      // a 16-bit typed memory view; keep the full samples for contrast stretch.
      bitsPerSample: precision ?? Number(info.bitsPerSample) ?? 12,
      componentCount: Number(info.componentCount) || 1,
      pixels: new Uint16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2)),
    };
  } finally {
    decoder.delete();
  }
}

function sampleAt(pixels: Uint16Array | Uint8Array, idx: number): number {
  return pixels[idx] ?? 0;
}

function autoStretchRange(samples: ArrayLike<number>) {
  if (!samples.length) return { lo: 0, hi: 255 };
  const hist = new Uint32Array(256);
  let max = 0;
  const step = Math.max(1, Math.floor(samples.length / 80_000));
  for (let i = 0; i < samples.length; i += step) {
    const v = samples[i] || 0;
    if (v > max) max = v;
  }
  const scale = max > 255 ? 4095 : 255;
  let count = 0;
  for (let i = 0; i < samples.length; i += step) {
    const v = Math.max(0, Math.min(255, Math.round(((samples[i] || 0) / scale) * 255)));
    hist[v]++;
    count++;
  }
  const lowTarget = count * 0.01;
  const highTarget = count * 0.99;
  let acc = 0;
  let loBin = 0;
  let hiBin = 255;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= lowTarget) {
      loBin = i;
      break;
    }
  }
  acc = 0;
  for (let i = 0; i < 256; i++) {
    acc += hist[i];
    if (acc >= highTarget) {
      hiBin = i;
      break;
    }
  }
  if (hiBin <= loBin) {
    loBin = 0;
    hiBin = 255;
  }
  return { lo: (loBin / 255) * scale, hi: (hiBin / 255) * scale };
}

function planeToBytes(plane: DecodedPlane): Uint8Array {
  const out = new Uint8Array(plane.width * plane.height);
  const { lo, hi } = autoStretchRange(plane.pixels);
  const range = Math.max(1, hi - lo);
  const gamma = 0.82;
  for (let i = 0; i < out.length; i++) {
    let n = (sampleAt(plane.pixels, i * plane.componentCount) - lo) / range;
    if (n < 0) n = 0;
    else if (n > 1) n = 1;
    out[i] = Math.round(Math.pow(n, gamma) * 255);
  }
  return out;
}

function rotateRgb270(src: Uint8ClampedArray, w: number, h: number) {
  const out = new Uint8ClampedArray(src.length);
  const outW = h;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const srcP = (y * w + x) * 4;
      const nx = y;
      const ny = w - 1 - x;
      const dstP = (ny * outW + nx) * 4;
      out[dstP] = src[srcP];
      out[dstP + 1] = src[srcP + 1];
      out[dstP + 2] = src[srcP + 2];
      out[dstP + 3] = 255;
    }
  }
  return { data: out, width: h, height: w };
}

function rgbaToDataUrl(rgba: Uint8ClampedArray, w: number, h: number): string | null {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
  return canvas.toDataURL("image/jpeg", 0.88);
}

/** Decode one raw PGR plane into a viewable grayscale data URL. */
export async function decodePlaneToDataUrl(buf: Uint8Array): Promise<DecodeResult> {
  try {
    const frame = await decodeJpegBuffer(buf);
    if (!frame.width || !frame.height) throw new Error("empty JPEG frame");
    const gray = planeToBytes(frame);
    const rgba = new Uint8ClampedArray(frame.width * frame.height * 4);
    for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
      rgba[p] = rgba[p + 1] = rgba[p + 2] = gray[i];
      rgba[p + 3] = 255;
    }
    const rot = rotateRgb270(rgba, frame.width, frame.height);
    return { ok: true, url: rgbaToDataUrl(rot.data, rot.width, rot.height), width: rot.width, height: rot.height };
  } catch (e) {
    return { ok: false, url: null, error: errorText(e) };
  }
}

/** Decode one full Ladybug camera by combining its R/G1/G2/B planes. */
export async function decodeCameraToDataUrl(planes: Uint8Array[]): Promise<CameraDecodeResult> {
  const decoded: Array<DecodedPlane | null> = [];
  const errors: string[] = [];

  for (const buf of planes) {
    try {
      decoded.push(await decodeJpegBuffer(buf));
    } catch (e) {
      decoded.push(null);
      errors.push(errorText(e));
    }
  }

  const ref = decoded.find(Boolean);
  if (!ref) {
    return {
      ok: false,
      url: null,
      sourceCount: planes.length,
      error: errors[0] || "No decodable JPEG planes for this camera",
    };
  }

  const w = ref.width;
  const h = ref.height;
  const stretched = decoded.map((p) => (p && p.width === w && p.height === h ? planeToBytes(p) : null));
  const rgba = new Uint8ClampedArray(w * h * 4);
  const zero = 0;

  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const r = stretched[0]?.[i] ?? stretched[1]?.[i] ?? zero;
    const g1 = stretched[1]?.[i];
    const g2 = stretched[2]?.[i];
    const g = g1 !== undefined && g2 !== undefined ? (g1 + g2) >> 1 : (g1 ?? g2 ?? r);
    const b = stretched[3]?.[i] ?? g;
    rgba[p] = r;
    rgba[p + 1] = g;
    rgba[p + 2] = b;
    rgba[p + 3] = 255;
  }

  const rot = rotateRgb270(rgba, w, h);
  return {
    ok: true,
    url: rgbaToDataUrl(rot.data, rot.width, rot.height),
    width: rot.width,
    height: rot.height,
    sourceCount: decoded.filter(Boolean).length,
  };
}