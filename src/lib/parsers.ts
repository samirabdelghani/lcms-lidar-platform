import JSZip from "jszip";

export interface GpsPoint {
  lat: number;
  lon: number;
  altitude_m: number;
  name: string;
  chainage_m: number;
  speed_kh: number;
}

export type Runs = Record<number, GpsPoint[]>;

export interface PgrPlane {
  /** Camera index 0..5 */
  camera: number;
  /** Plane index 0..3 within the camera */
  plane: number;
  /** Absolute byte offset of the JPEG payload */
  offset: number;
  /** Payload size in bytes */
  size: number;
}

export interface PgrFrame {
  /** Absolute offset of the frame header start */
  frameStart: number;
  /** Decoded planes (one entry per detected sub-image) */
  planes: PgrPlane[];
}

export interface PgrScanResult {
  frames: PgrFrame[];
  fileSize: number;
}

// ─── GPS helpers ──────────────────────────────────────────────

export function nmeaToDecimal(coord: string, direction: string): number {
  if (!coord || !direction) return 0;
  const c = parseFloat(coord);
  if (!isFinite(c)) return 0;
  const degrees = Math.floor(c / 100);
  const minutes = c - degrees * 100;
  let decimal = degrees + minutes / 60;
  if (direction === "S" || direction === "W") decimal *= -1;
  return decimal;
}

function haversineM(a: GpsPoint, b: GpsPoint): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dp = toRad(b.lat - a.lat);
  const dl = toRad(b.lon - a.lon);
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Adaptive sampling so dense tracks stay snappy. Preserves first/last. */
export function decimateGpsPoints(pts: GpsPoint[], maxPoints = 5000): GpsPoint[] {
  if (pts.length <= maxPoints) return pts;
  const step = pts.length / maxPoints;
  const out: GpsPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.floor(i * step);
    if (idx < pts.length) out.push(pts[idx]);
  }
  const last = pts[pts.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

function catmullRom(
  p0: GpsPoint,
  p1: GpsPoint,
  p2: GpsPoint,
  p3: GpsPoint,
  steps: number,
): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const mLat1 = 0.5 * (p2.lat - p0.lat);
    const mLon1 = 0.5 * (p2.lon - p0.lon);
    const mLat2 = 0.5 * (p3.lat - p1.lat);
    const mLon2 = 0.5 * (p3.lon - p1.lon);
    out.push([
      h00 * p1.lat + h10 * mLat1 + h01 * p2.lat + h11 * mLat2,
      h00 * p1.lon + h10 * mLon1 + h01 * p2.lon + h11 * mLon2,
    ]);
  }
  return out;
}

function smoothSegment(seg: GpsPoint[], steps = 8): [number, number][] {
  const n = seg.length;
  if (n < 2) return seg.map((p) => [p.lat, p.lon]);
  if (n === 2) return seg.map((p) => [p.lat, p.lon]);
  const out: [number, number][] = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = seg[Math.max(0, i - 1)];
    const p1 = seg[i];
    const p2 = seg[i + 1];
    const p3 = seg[Math.min(n - 1, i + 2)];
    out.push(...catmullRom(p0, p1, p2, p3, steps));
  }
  const last = seg[n - 1];
  out.push([last.lat, last.lon]);
  return out;
}

/**
 * Split a track wherever consecutive points are more than `maxGapM` metres apart,
 * then Catmull-Rom smooth each segment with `steps` interpolations per span.
 */
export function buildSmoothedSegments(
  pts: GpsPoint[],
  maxGapM = 50,
  steps = 8,
): [number, number][][] {
  if (pts.length === 0) return [];
  const segments: GpsPoint[][] = [];
  let current: GpsPoint[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    if (haversineM(pts[i - 1], pts[i]) <= maxGapM) {
      current.push(pts[i]);
    } else {
      if (current.length >= 2) segments.push(current);
      current = [pts[i]];
    }
  }
  if (current.length >= 2) segments.push(current);
  return segments.map((s) => smoothSegment(s, steps));
}

/** Apply decimation + (optional) smoothing across all runs; useful for exports. */
export function processRunsForExport(
  runs: Runs,
  opts: { maxPoints: number; smooth: boolean; steps: number; maxGapM: number },
): Runs {
  const out: Runs = {};
  for (const [k, pts] of Object.entries(runs)) {
    const dec = decimateGpsPoints(pts, opts.maxPoints);
    if (!opts.smooth) {
      out[Number(k)] = dec;
      continue;
    }
    const segs = buildSmoothedSegments(dec, opts.maxGapM, opts.steps);
    const flat: GpsPoint[] = [];
    let i = 0;
    for (const seg of segs) {
      for (const [lat, lon] of seg) {
        const ref = dec[Math.min(i, dec.length - 1)];
        flat.push({
          lat,
          lon,
          altitude_m: ref?.altitude_m ?? 0,
          chainage_m: ref?.chainage_m ?? 0,
          speed_kh: ref?.speed_kh ?? 0,
          name: ref?.name ?? `Pt ${i}`,
        });
        i++;
      }
    }
    out[Number(k)] = flat;
  }
  return out;
}

// ─── LCMS log parsing ─────────────────────────────────────────

/** Parse LCMS continuous raw text-stream logs (one JSON record per line). */
export async function extractGpsFromLcmsTxt(files: File[]): Promise<Runs> {
  const runs: Runs = { 1: [] };
  for (const file of files) {
    const text = await file.text();
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      try {
        const record = JSON.parse(line);
        const odo = record.OdoDataRecord ?? {};
        const nmea: string = record.NmeaLine ?? "";
        if (!nmea) continue;
        const parts = nmea.split(",");
        if (!(parts[0]?.endsWith("GGA") || parts[0]?.endsWith("RMC"))) continue;
        const lat = nmeaToDecimal(parts[2], parts[3]);
        const lon = nmeaToDecimal(parts[4], parts[5]);
        if (lat === 0 && lon === 0) continue;
        runs[1].push({
          lat,
          lon,
          altitude_m: 0,
          name: `Odo: ${odo.Time ?? 0}`,
          chainage_m: parseFloat(odo.Chainage ?? 0) || 0,
          speed_kh: (parseFloat(odo.Speed ?? 0) || 0) * 3.6,
        });
      } catch {
        /* skip malformed line */
      }
    }
  }
  return runs;
}

// ─── KML / KMZ parsing with per-run grouping ──────────────────

const RUN_NAME_RE = /run[\s_-]*0*(\d+)/i;
const STRIP_PLACEMARK_NAMES = new Set(["trajectory_path - 0001", "trajectory_path-0001"]);

function parseCoordText(text: string): GpsPoint[] {
  const pts: GpsPoint[] = [];
  for (const chunk of text.trim().split(/\s+/)) {
    const parts = chunk.split(",");
    if (parts.length < 2) continue;
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    const alt = parts.length > 2 ? parseFloat(parts[2]) : 0;
    if (!isFinite(lat) || !isFinite(lon)) continue;
    if (lat === 0 && lon === 0) continue;
    pts.push({
      lat,
      lon,
      altitude_m: alt || 0,
      name: `Pt ${pts.length}`,
      chainage_m: pts.length * 5,
      speed_kh: 60,
    });
  }
  return pts;
}

function parseKmlText(text: string, fallbackStartIdx: { v: number }): Runs {
  const runs: Runs = {};
  const doc = new DOMParser().parseFromString(text, "application/xml");
  const placemarks = doc.getElementsByTagName("Placemark");
  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i];
    const nameEl = pm.getElementsByTagName("name")[0];
    const rawName = (nameEl?.textContent ?? "").trim();
    if (STRIP_PLACEMARK_NAMES.has(rawName.toLowerCase())) continue;
    const match = RUN_NAME_RE.exec(rawName);
    const runNumber = match ? parseInt(match[1], 10) : fallbackStartIdx.v;
    const coordEls = pm.getElementsByTagName("coordinates");
    const pts: GpsPoint[] = [];
    for (let j = 0; j < coordEls.length; j++) {
      const txt = coordEls[j].textContent;
      if (txt) pts.push(...parseCoordText(txt));
    }
    if (!pts.length) continue;
    runs[runNumber] = (runs[runNumber] ?? []).concat(pts);
    if (!match) fallbackStartIdx.v += 1;
  }
  // Fallback: no Placemarks at all → use raw <coordinates>
  if (Object.keys(runs).length === 0) {
    const coordEls = doc.getElementsByTagName("coordinates");
    for (let i = 0; i < coordEls.length; i++) {
      const txt = coordEls[i].textContent;
      if (!txt) continue;
      const pts = parseCoordText(txt);
      if (pts.length) {
        runs[fallbackStartIdx.v++] = pts;
      }
    }
  }
  return runs;
}

/** Parse KML or KMZ files into Runs, grouping by placemark "Run NNNN". */
export async function extractGpsFromKml(files: File[]): Promise<Runs> {
  const out: Runs = {};
  const idx = { v: 1 };
  for (const file of files) {
    const lower = file.name.toLowerCase();
    const texts: string[] = [];
    if (lower.endsWith(".kmz")) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      for (const f of Object.values(zip.files)) {
        if (f.name.toLowerCase().endsWith(".kml")) texts.push(await f.async("string"));
      }
    } else {
      texts.push(await file.text());
    }
    for (const t of texts) {
      const partial = parseKmlText(t, idx);
      for (const [k, v] of Object.entries(partial)) {
        const key = Number(k);
        out[key] = (out[key] ?? []).concat(v);
        idx.v = Math.max(idx.v, key + 1);
      }
    }
  }
  return out;
}

// ─── PGR binary scanner (header-aware) ────────────────────────

const PGR_FRAME_HEADER_SIZE = 1024;
const PGR_MAX_SUBIMAGES = 24; // 6 cameras × 4 planes
const PGR_IMAGE_TABLE_OFFSET = PGR_FRAME_HEADER_SIZE - PGR_MAX_SUBIMAGES * 8; // 832
const PGR_MIN_SUBIMAGE_BYTES = 1024;
const PGR_PLANES_PER_CAMERA = 4;
const PGR_CAFEBABE = 0xcafebabe;

/**
 * Scan a PGR binary stream for valid frames. For each frame, parse the 24-entry
 * sub-image table and validate JPEG SOI markers. Mirrors the canonical
 * scan_pgr_frames_optimized from the desktop viewer.
 */
export async function scanPgrFrames(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<PgrScanResult> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(buf.buffer);
  const total = buf.length;
  const frames: PgrFrame[] = [];
  let pos = 0;
  let lastReport = 0;

  while (pos < total - 4) {
    // Find next 0xCAFEBABE marker (big-endian on disk)
    let idx = -1;
    for (let i = pos; i < total - 4; i++) {
      if (
        buf[i] === 0xca &&
        buf[i + 1] === 0xfe &&
        buf[i + 2] === 0xba &&
        buf[i + 3] === 0xbe
      ) {
        idx = i;
        break;
      }
      if (onProgress && i - lastReport > 8_000_000) {
        lastReport = i;
        onProgress(Math.min(99, (i / total) * 100));
        // Yield to UI
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (idx === -1) break;

    const frameStart = idx - 16;
    if (frameStart < 0 || frameStart + PGR_FRAME_HEADER_SIZE > total) {
      pos = idx + 4;
      continue;
    }
    // Validate big-endian signature at frameStart + 16
    if (view.getUint32(frameStart + 16, false) !== PGR_CAFEBABE) {
      pos = idx + 4;
      continue;
    }

    const tableBase = frameStart + PGR_IMAGE_TABLE_OFFSET;
    const planes: PgrPlane[] = [];
    for (let i = 0; i < PGR_MAX_SUBIMAGES; i++) {
      const entry = tableBase + i * 8;
      if (entry + 8 > total) break;
      const imgOff = view.getUint32(entry, false);
      const imgSize = view.getUint32(entry + 4, false);
      if (imgSize < PGR_MIN_SUBIMAGE_BYTES) continue;
      const absStart = frameStart + imgOff;
      const absEnd = absStart + imgSize;
      if (absEnd > total) continue;
      // JPEG SOI marker
      if (buf[absStart] !== 0xff || buf[absStart + 1] !== 0xd8) continue;
      planes.push({
        camera: Math.floor(i / PGR_PLANES_PER_CAMERA),
        plane: i % PGR_PLANES_PER_CAMERA,
        offset: absStart,
        size: imgSize,
      });
    }

    if (planes.length >= PGR_PLANES_PER_CAMERA) {
      frames.push({ frameStart, planes });
    }
    pos = idx + 4;
  }

  onProgress?.(100);
  return { frames, fileSize: total };
}

/** Extract the raw JPEG bytes for a single plane from the underlying file. */
export async function extractPgrPlaneBytes(file: File, plane: PgrPlane): Promise<Blob> {
  return file.slice(plane.offset, plane.offset + plane.size, "image/jpeg");
}

// ─── Exports ──────────────────────────────────────────────────

export function gpsToCsv(runs: Runs): string {
  const header = "run,index,lat,lon,altitude_m,chainage_m,speed_kh,name";
  const rows: string[] = [header];
  for (const [run, pts] of Object.entries(runs)) {
    pts.forEach((p, i) => {
      const safeName = p.name.replace(/[",\n]/g, " ");
      rows.push(
        `${run},${i},${p.lat},${p.lon},${p.altitude_m},${p.chainage_m},${p.speed_kh.toFixed(2)},"${safeName}"`,
      );
    });
  }
  return rows.join("\n");
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function gpsToKml(runs: Runs, name = "Runway Core GPS"): string {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "<Document>",
    `  <name>${esc(name)}</name>`,
    '  <Style id="trackLine">',
    "    <LineStyle><color>ff00d4ff</color><width>3</width></LineStyle>",
    "    <PolyStyle><fill>0</fill></PolyStyle>",
    "  </Style>",
  ];
  for (const [runId, pts] of Object.entries(runs)) {
    if (!pts.length) continue;
    lines.push(
      "  <Placemark>",
      `    <name>Run ${runId}</name>`,
      "    <styleUrl>#trackLine</styleUrl>",
      "    <LineString>",
      "      <tessellate>1</tessellate>",
      "      <coordinates>",
    );
    for (const p of pts) {
      lines.push(`        ${p.lon},${p.lat},${p.altitude_m || 0}`);
    }
    lines.push("      </coordinates>", "    </LineString>", "  </Placemark>");
  }
  lines.push("</Document>", "</kml>");
  return lines.join("\n");
}

export async function gpsToKmz(runs: Runs, name = "Runway Core GPS"): Promise<Blob> {
  const zip = new JSZip();
  zip.file("doc.kml", gpsToKml(runs, name));
  return zip.generateAsync({ type: "blob", compression: "DEFLATE" });
}

export function downloadFile(content: string | Blob, filename: string, mime = "text/plain") {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Summary ──────────────────────────────────────────────────

export function summarizeRuns(runs: Runs) {
  const allPts = Object.values(runs).flat();
  const totalPoints = allPts.length;
  const lastRun = Object.values(runs).find((r) => r.length > 0) ?? [];
  const last = lastRun[lastRun.length - 1];
  return {
    totalPoints,
    runCount: Object.keys(runs).length,
    chainage_m: last?.chainage_m ?? 0,
    speed_kh: last?.speed_kh ?? 0,
    distance_km: (last?.chainage_m ?? 0) / 1000,
  };
}
