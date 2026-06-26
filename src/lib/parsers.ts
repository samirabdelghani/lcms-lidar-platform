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

function parseKmlText(text: string, startIdx: number): Runs {
  const runs: Runs = {};
  let idx = startIdx;
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, "application/xml");
  const coordEls = doc.getElementsByTagName("coordinates");
  for (let i = 0; i < coordEls.length; i++) {
    const raw = coordEls[i].textContent?.trim() ?? "";
    if (!raw) continue;
    const pts: GpsPoint[] = [];
    for (const chunk of raw.split(/\s+/)) {
      const parts = chunk.split(",");
      if (parts.length < 2) continue;
      const lon = parseFloat(parts[0]);
      const lat = parseFloat(parts[1]);
      const alt = parts.length > 2 ? parseFloat(parts[2]) : 0;
      if (!isFinite(lat) || !isFinite(lon)) continue;
      pts.push({
        lat,
        lon,
        altitude_m: alt || 0,
        name: `Pt ${pts.length}`,
        chainage_m: pts.length * 5,
        speed_kh: 60,
      });
    }
    if (pts.length) {
      runs[idx++] = pts;
    }
  }
  return runs;
}

/** Parse KML or KMZ files into Runs. KMZ is unzipped client-side. */
export async function extractGpsFromKml(files: File[]): Promise<Runs> {
  const out: Runs = {};
  let idx = 1;
  for (const file of files) {
    const name = file.name.toLowerCase();
    let kmlTexts: string[] = [];
    if (name.endsWith(".kmz")) {
      const zip = await JSZip.loadAsync(await file.arrayBuffer());
      const kmlEntries = Object.values(zip.files).filter((f) =>
        f.name.toLowerCase().endsWith(".kml"),
      );
      for (const entry of kmlEntries) kmlTexts.push(await entry.async("string"));
    } else {
      kmlTexts.push(await file.text());
    }
    for (const text of kmlTexts) {
      const partial = parseKmlText(text, idx);
      for (const [k, v] of Object.entries(partial)) {
        out[Number(k)] = v;
        idx = Math.max(idx, Number(k) + 1);
      }
    }
  }
  return out;
}

/** Scan PGR binary stream for frame sync markers (0xFFFFFFFF). */
export async function scanPgrFrames(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<number[]> {
  const offsets: number[] = [];
  const buf = new Uint8Array(await file.arrayBuffer());
  const size = buf.length;
  const SKIP = 2_000_000; // coarse skip over frame body
  let pos = 0;
  let lastReported = 0;
  while (pos < size - 4) {
    if (
      buf[pos] === 0xff &&
      buf[pos + 1] === 0xff &&
      buf[pos + 2] === 0xff &&
      buf[pos + 3] === 0xff
    ) {
      offsets.push(pos);
      pos += SKIP;
    } else {
      pos += 1;
    }
    if (onProgress && pos - lastReported > 5_000_000) {
      lastReported = pos;
      onProgress(Math.min(100, (pos / size) * 100));
    }
  }
  onProgress?.(100);
  return offsets;
}

export function summarizeRuns(runs: Runs) {
  const totalPoints = Object.values(runs).reduce((a, v) => a + v.length, 0);
  const firstRun = Object.values(runs)[0] ?? [];
  const last = firstRun[firstRun.length - 1];
  return {
    totalPoints,
    runCount: Object.keys(runs).length,
    chainage_m: last?.chainage_m ?? 0,
    speed_kh: last?.speed_kh ?? 0,
    distance_km: (last?.chainage_m ?? 0) / 1000,
  };
}
