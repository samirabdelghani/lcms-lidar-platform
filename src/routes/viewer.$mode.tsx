import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  ArrowLeft,
  Database,
  Download,
  FileUp,
  Filter,
  Hexagon,
  Layers,
  Loader2,
  Radar,
  Sparkles,
} from "lucide-react";
import {
  downloadFile,
  extractGpsFromKml,
  extractGpsFromLcmsTxt,
  gpsToCsv,
  gpsToKml,
  gpsToKmz,
  processRunsForExport,
  scanPgrFrames,
  summarizeRuns,
  type PgrScanResult,
  type Runs,
} from "@/lib/parsers";
import { TelemetryDashboard } from "@/components/TelemetryDashboard";
import { Console, type LogEntry } from "@/components/Console";
import { FramePreview } from "@/components/FramePreview";
import { QualityMenu } from "@/components/QualityMenu";
import type { QualitySettings } from "@/components/MapView";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const MapView = lazy(() =>
  import("@/components/MapView").then((m) => ({ default: m.MapView })),
);

type Mode = "lcms" | "lidar";

export const Route = createFileRoute("/viewer/$mode")({
  beforeLoad: ({ params }) => {
    if (params.mode !== "lcms" && params.mode !== "lidar") throw notFound();
  },
  head: ({ params }) => {
    const isLcms = params.mode === "lcms";
    const title = isLcms
      ? "LCMS Asset Workspace · Runway Core"
      : "LiDAR Geospatial Workspace · Runway Core";
    return {
      meta: [
        { title },
        {
          name: "description",
          content: isLcms
            ? "Parse and visualize LCMS raw pavement survey logs with NMEA + chainage telemetry."
            : "Import KML / KMZ LiDAR mission tracks and visualize them on a satellite basemap.",
        },
      ],
    };
  },
  component: ViewerPage,
});

function ViewerPage() {
  const { mode } = Route.useParams() as { mode: Mode };
  const isLcms = mode === "lcms";

  const [runs, setRuns] = useState<Runs>({});
  const [visibleRuns, setVisibleRuns] = useState<Set<number>>(new Set());
  const [layers, setLayers] = useState({
    track: true,
    nodes: true,
    smooth: true,
    distress: false,
    macro: false,
  });
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [pgrScan, setPgrScan] = useState<PgrScanResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pgrInputRef = useRef<HTMLInputElement>(null);
  const [quality, setQuality] = useState<QualitySettings>({
    maxPoints: 5000,
    steps: 8,
    maxGapM: 50,
  });
  const [renderStats, setRenderStats] = useState({ source: 0, rendered: 0 });
  const [frameIdx, setFrameIdx] = useState(0);

  const log = useCallback((text: string, level: LogEntry["level"] = "info") => {
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setLogs((l) => [...l, { ts, text, level }]);
  }, []);

  const filteredRuns = useMemo<Runs>(() => {
    if (visibleRuns.size === 0) return runs;
    const out: Runs = {};
    for (const [k, v] of Object.entries(runs)) {
      if (visibleRuns.has(Number(k))) out[Number(k)] = v;
    }
    return out;
  }, [runs, visibleRuns]);

  const summary = useMemo(() => summarizeRuns(filteredRuns), [filteredRuns]);

  // Flat ordered list of all visible GPS points (one source of truth for
  // frame ↔ position mapping and click-to-nearest).
  const flatGps = useMemo(() => {
    const out: { lat: number; lon: number; run: number }[] = [];
    for (const [k, pts] of Object.entries(filteredRuns)) {
      const run = Number(k);
      for (const p of pts) out.push({ lat: p.lat, lon: p.lon, run });
    }
    return out;
  }, [filteredRuns]);

  const frameCount = pgrScan?.frames.length ?? 0;

  // Linear time-base mapping: frame i ↔ gps[ round(i/(N-1) * (M-1)) ].
  const gpsForFrame = useCallback(
    (idx: number) => {
      if (!flatGps.length || frameCount === 0) return null;
      const denom = Math.max(1, frameCount - 1);
      const gIdx = Math.round((idx / denom) * (flatGps.length - 1));
      return flatGps[Math.max(0, Math.min(flatGps.length - 1, gIdx))];
    },
    [flatGps, frameCount],
  );

  const currentPos = useMemo<[number, number] | null>(() => {
    const g = gpsForFrame(frameIdx);
    return g ? [g.lat, g.lon] : null;
  }, [gpsForFrame, frameIdx]);

  const handleMapClick = useCallback(
    (lat: number, lon: number) => {
      if (!flatGps.length || frameCount === 0) return;
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < flatGps.length; i++) {
        const dLat = flatGps[i].lat - lat;
        const dLon = flatGps[i].lon - lon;
        const d = dLat * dLat + dLon * dLon;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const denom = Math.max(1, flatGps.length - 1);
      const fIdx = Math.round((best / denom) * (frameCount - 1));
      setFrameIdx(Math.max(0, Math.min(frameCount - 1, fIdx)));
      log(`Jumped to frame ${fIdx + 1} @ ${flatGps[best].lat.toFixed(5)}, ${flatGps[best].lon.toFixed(5)}.`, "success");
    },
    [flatGps, frameCount, log],
  );



  const handleGpsFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setProgress(20);
    log(`Spawning parser pool for ${files.length} record file(s)…`);
    const start = performance.now();
    try {
      const arr = Array.from(files);
      const out = isLcms
        ? await extractGpsFromLcmsTxt(arr)
        : await extractGpsFromKml(arr);
      const duration = (performance.now() - start) / 1000;
      setRuns(out);
      setVisibleRuns(new Set(Object.keys(out).map(Number)));
      setProgress(100);
      const total = Object.values(out).reduce((a, v) => a + v.length, 0);
      log(
        `Telemetry sync complete in ${duration.toFixed(2)}s. Parsed ${total} positions across ${Object.keys(out).length} run(s).`,
        "success",
      );
    } catch (e) {
      log(`Parse failure: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(0), 800);
    }
  };

  const handlePgrFile = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const arr = Array.from(files);
    const totalMB = arr.reduce((a, f) => a + f.size, 0) / 1e6;
    setBusy(true);
    setProgress(0);
    log(`Indexing ${arr.length} PGR stream(s) · ${totalMB.toFixed(2)} MB total`);
    try {
      const result = await scanPgrFrames(arr, (p) => setProgress(p));
      setPgrScan(result);
      const planeCount = result.frames.reduce((a, f) => a + f.planes.length, 0);
      log(
        `Mapped ${result.frames.length} frames · ${planeCount} planes across ${arr.length} file(s).`,
        "success",
      );
    } catch (e) {
      log(`PGR scan failure: ${(e as Error).message}`, "error");
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(0), 800);
    }
  };


  const countPts = (r: Runs) => Object.values(r).reduce((a, v) => a + v.length, 0);

  const exportRuns = () =>
    processRunsForExport(filteredRuns, {
      maxPoints: quality.maxPoints,
      smooth: layers.smooth,
      steps: quality.steps,
      maxGapM: quality.maxGapM,
    });

  const exportCsv = () => {
    if (Object.keys(filteredRuns).length === 0) {
      log("No GPS data to export.", "error");
      return;
    }
    const out = exportRuns();
    downloadFile(gpsToCsv(out), `runway-core-gps-${Date.now()}.csv`, "text/csv");
    log(`GPS export → CSV emitted (${countPts(out)} pts).`, "success");
  };

  const exportKml = () => {
    if (Object.keys(filteredRuns).length === 0) {
      log("No GPS data to export.", "error");
      return;
    }
    const out = exportRuns();
    downloadFile(
      gpsToKml(out),
      `runway-core-gps-${Date.now()}.kml`,
      "application/vnd.google-earth.kml+xml",
    );
    log(`GPS export → KML emitted (${countPts(out)} pts).`, "success");
  };

  const exportKmz = async () => {
    if (Object.keys(filteredRuns).length === 0) {
      log("No GPS data to export.", "error");
      return;
    }
    const out = exportRuns();
    const blob = await gpsToKmz(out);
    downloadFile(blob, `runway-core-gps-${Date.now()}.kmz`, "application/vnd.google-earth.kmz");
    log(`GPS export → KMZ emitted (${countPts(out)} pts).`, "success");
  };

  const exportFirstFramePlane = async () => {
    if (!pgrScan || pgrScan.frames.length === 0) {
      log("Queue a PGR stream first.", "error");
      return;
    }
    const frame = pgrScan.frames[0];
    const src = pgrScan.files[frame.fileIndex];
    const plane = frame.planes[0];
    const blob = src.slice(plane.offset, plane.offset + plane.size, "image/jpeg");
    downloadFile(blob, `frame0-cam${plane.camera}-plane${plane.plane}.jpg`, "image/jpeg");
    log(`Extracted JPEG payload (${(plane.size / 1024).toFixed(1)} KB) from cam ${plane.camera}.`, "success");
  };


  return (
    <main className="flex h-screen flex-col bg-background text-foreground">
      {/* Top bar */}
      <header className="flex items-center gap-4 border-b border-border bg-card/70 px-4 py-3">
        <Link
          to="/"
          className="flex items-center gap-2 text-xs text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          <span className="hidden sm:inline">Workspaces</span>
        </Link>
        <div className="mx-2 h-6 w-px bg-border" />
        <div className="flex items-center gap-2">
          <Hexagon className="size-5 text-accent" />
          <div className="font-semibold tracking-[0.14em]">RUNWAY CORE</div>
          <span className="rounded-full border border-border bg-background/60 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {isLcms ? "LCMS Mode" : "LiDAR Geospatial Mode"}
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            accept={
              isLcms
                ? ".txt,text/plain"
                : ".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz"
            }
            onChange={(e) => handleGpsFiles(e.target.files)}
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={busy} size="sm">
            <FileUp className="size-4" />
            {isLcms ? "Load LCMS logs (.TXT)" : "Import LiDAR (.KML/.KMZ)"}
          </Button>

          <input
            ref={pgrInputRef}
            type="file"
            multiple
            hidden
            accept=".pgr,application/octet-stream"
            onChange={(e) => handlePgrFile(e.target.files)}
          />
          <Button
            onClick={() => pgrInputRef.current?.click()}
            disabled={busy}
            size="sm"
            variant="outline"
          >
            <Radar className="size-4" />
            Queue PGR Stream
          </Button>

          <RunFilter
            runs={runs}
            visible={visibleRuns}
            onChange={setVisibleRuns}
          />

          <ExportMenu
            onCsv={exportCsv}
            onKml={exportKml}
            onKmz={exportKmz}
            onPgrPlane={exportFirstFramePlane}
            hasGps={Object.keys(filteredRuns).length > 0}
            hasPgr={!!pgrScan && pgrScan.frames.length > 0}
          />

          <QualityMenu
            value={quality}
            smooth={layers.smooth}
            onSmoothChange={(v) => setLayers({ ...layers, smooth: v })}
            onChange={setQuality}
            stats={renderStats}
          />

          <LayersMenu layers={layers} onChange={setLayers} />
        </div>
      </header>

      {/* Progress hub */}
      <div className="h-1 bg-border/40">
        {progress > 0 && <Progress value={progress} className="h-1 rounded-none" />}
      </div>

      {/* Workspace */}
      <div className="grid flex-1 grid-cols-1 gap-3 overflow-hidden p-3 lg:grid-cols-[minmax(0,1fr)_minmax(380px,38%)]">
        {/* Left: stream view + dashboard */}
        <section className="flex min-h-0 flex-col gap-3">
          <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-xl border border-border bg-card/60 shadow-[var(--shadow-card)]">
            <div className="bg-grid absolute inset-0 opacity-30" />
            <div className="relative max-w-md p-8 text-center">
              <div className="mx-auto mb-4 grid size-14 place-items-center rounded-xl border border-border bg-background/60">
                <Database className="size-6 text-accent" />
              </div>
              <h3 className="text-lg font-semibold">
                {pgrScan
                  ? `Stream indexed · ${pgrScan.frames.length} frames`
                  : "Multi-Sensor Stream Offline"}
              </h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {pgrScan
                  ? `First frame @ byte 0x${pgrScan.frames[0]?.frameStart.toString(16).toUpperCase() ?? "—"}. JPEG12 imagery decode is decoder-bound; export raw plane payloads via the export menu.`
                  : "Queue a PGR laser stream or load a survey log to bring the canvas online."}
              </p>
            </div>
            {pgrScan && pgrScan.frames.length > 0 && (
              <FramePreview scan={pgrScan} />
            )}
          </div>

          <TelemetryDashboard
            chainage_m={summary.chainage_m}
            speed_kh={summary.speed_kh}
            distance_km={summary.distance_km}
            rate_hz={summary.totalPoints > 0 ? 20 : 0}
          />
        </section>

        {/* Right: map + console */}
        <section className="flex min-h-0 flex-col gap-3">
          <div className="relative flex-1 overflow-hidden rounded-xl border border-border bg-card/60 shadow-[var(--shadow-card)]">
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  <Loader2 className="mr-2 size-4 animate-spin" /> Loading geospatial engine…
                </div>
              }
            >
              <MapView
                runs={filteredRuns}
                showTrack={layers.track}
                showNodes={layers.nodes}
                smooth={layers.smooth}
                quality={quality}
                onStats={setRenderStats}
              />
            </Suspense>
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-md border border-border bg-background/80 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider text-muted-foreground backdrop-blur">
              <Sparkles className="size-3 text-accent" />
              {summary.totalPoints.toLocaleString()} src · {renderStats.rendered.toLocaleString()} drawn · {summary.runCount} run(s)
            </div>
          </div>
          <div className="h-44 shrink-0 rounded-xl border border-border bg-card/60 p-2 shadow-[var(--shadow-card)]">
            <Console entries={logs} />
          </div>
        </section>
      </div>
    </main>
  );
}

function RunFilter({
  runs,
  visible,
  onChange,
}: {
  runs: Runs;
  visible: Set<number>;
  onChange: (s: Set<number>) => void;
}) {
  const [open, setOpen] = useState(false);
  const runIds = Object.keys(runs)
    .map(Number)
    .sort((a, b) => a - b);

  const toggle = (id: number) => {
    const next = new Set(visible);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  if (runIds.length === 0) return null;

  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
        <Filter className="size-4" />
        Runs ({visible.size}/{runIds.length})
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[1001] mt-2 w-56 rounded-md border border-border bg-popover p-2 shadow-[var(--shadow-glow)]">
            <div className="mb-1 flex justify-between gap-2 px-1 text-[11px] uppercase tracking-wider text-muted-foreground">
              <button
                className="hover:text-foreground"
                onClick={() => onChange(new Set(runIds))}
              >
                Select all
              </button>
              <button className="hover:text-foreground" onClick={() => onChange(new Set())}>
                Clear
              </button>
            </div>
            <div className="max-h-64 overflow-auto">
              {runIds.map((id) => (
                <label
                  key={id}
                  className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/10"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={visible.has(id)}
                      onChange={() => toggle(id)}
                      className="accent-[color:var(--accent)]"
                    />
                    Run {String(id).padStart(4, "0")}
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {runs[id]?.length ?? 0}
                  </span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function ExportMenu({
  onCsv,
  onKml,
  onKmz,
  onPgrPlane,
  hasGps,
  hasPgr,
}: {
  onCsv: () => void;
  onKml: () => void;
  onKmz: () => void | Promise<void>;
  onPgrPlane: () => void;
  hasGps: boolean;
  hasPgr: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
        <Download className="size-4" />
        Export
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[1001] mt-2 w-56 rounded-md border border-border bg-popover p-2 shadow-[var(--shadow-glow)]">
            <button
              disabled={!hasGps}
              onClick={() => {
                setOpen(false);
                onCsv();
              }}
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              GPS Track → CSV
            </button>
            <button
              disabled={!hasGps}
              onClick={() => {
                setOpen(false);
                onKml();
              }}
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              GPS Track → KML
            </button>
            <button
              disabled={!hasGps}
              onClick={() => {
                setOpen(false);
                void onKmz();
              }}
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              GPS Track → KMZ
            </button>
            <div className="my-1 h-px bg-border" />
            <button
              disabled={!hasPgr}
              onClick={() => {
                setOpen(false);
                onPgrPlane();
              }}
              className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              First PGR plane → JPEG
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function LayersMenu({
  layers,
  onChange,
}: {
  layers: {
    track: boolean;
    nodes: boolean;
    smooth: boolean;
    distress: boolean;
    macro: boolean;
  };
  onChange: (l: typeof layers) => void;
}) {
  const [open, setOpen] = useState(false);
  const items = [
    { key: "track", label: "GPS Track Overlay" },
    { key: "smooth", label: "Catmull-Rom Smoothing" },
    { key: "nodes", label: "Chainage Nodes" },
    { key: "distress", label: "Pavement Distress" },
    { key: "macro", label: "Macrotexture Index" },
  ] as const;
  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
        <Layers className="size-4" />
        Structural Layers
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[1001] mt-2 w-56 rounded-md border border-border bg-popover p-2 shadow-[var(--shadow-glow)]">
            {items.map((it) => (
              <label
                key={it.key}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/10"
              >
                <input
                  type="checkbox"
                  checked={layers[it.key]}
                  onChange={(e) => onChange({ ...layers, [it.key]: e.target.checked })}
                  className="accent-[color:var(--accent)]"
                />
                {it.label}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
