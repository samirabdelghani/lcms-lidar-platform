import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Grid2X2, Pause, Play, SkipBack, SkipForward, Waypoints } from "lucide-react";
import type { PgrScanResult } from "@/lib/parsers";
import { decodeCameraToDataUrl } from "@/lib/jpeg12";

interface Props {
  scan: PgrScanResult;
  frameIdx: number;
  onFrameIdxChange: (idx: number) => void;
  /** Called every animation frame while playing with a fractional frame index. */
  onPlayheadChange?: (fractional: number) => void;
  onPlayingChange?: (playing: boolean) => void;
}

interface CameraSlot {
  camera: number;
  size: number;
  planeCount: number;
  url: string | null;
  failed: boolean;
  error?: string;
  width?: number;
  height?: number;
}

type ViewMode = "grid" | "focus";

const CAMERA_NAMES = ["Front L", "Front R", "Right", "Rear", "Left", "Top"];

export function FramePreview({
  scan,
  frameIdx,
  onFrameIdxChange,
  onPlayheadChange,
  onPlayingChange,
}: Props) {
  const [slots, setSlots] = useState<CameraSlot[]>([]);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(10);
  const [viewMode, setViewMode] = useState<ViewMode>("focus");
  const [focusCam, setFocusCam] = useState(0);
  const rafRef = useRef<number | null>(null);

  const frame = useMemo(() => scan.frames[frameIdx], [scan, frameIdx]);
  const srcFile = useMemo(
    () => (frame ? scan.files[frame.fileIndex] : null),
    [frame, scan.files],
  );

  useEffect(() => {
    onPlayingChange?.(playing);
  }, [playing, onPlayingChange]);

  // Decode the current frame as six real RGB road cameras. Each camera is
  // composed from its 4 Bayer planes: R + averaged G1/G2 + B.
  useEffect(() => {
    if (!frame || !srcFile) return;
    let cancelled = false;

    const byCamera = new Map<number, typeof frame.planes>();
    for (const p of frame.planes) {
      const list = byCamera.get(p.camera) ?? [];
      list.push(p);
      byCamera.set(p.camera, list);
    }

    const initial: CameraSlot[] = Array.from({ length: 6 }).map((_, cam) => {
      const planes = (byCamera.get(cam) ?? []).sort((a, b) => a.plane - b.plane);
      return {
        camera: cam,
        size: planes.reduce((a, p) => a + p.size, 0),
        planeCount: planes.length,
        url: null,
        failed: planes.length === 0,
        error: planes.length === 0 ? "no camera planes" : undefined,
      };
    });
    setSlots(initial);

    (async () => {
      for (let cam = 0; cam < 6; cam++) {
        const planes = (byCamera.get(cam) ?? []).sort((a, b) => a.plane - b.plane);
        if (planes.length === 0) continue;
        try {
          const buffers = await Promise.all(
            planes.slice(0, 4).map(async (p) => {
              const ab = await srcFile.slice(p.offset, p.offset + p.size).arrayBuffer();
              return new Uint8Array(ab);
            }),
          );
          const result = await decodeCameraToDataUrl(buffers);
          if (cancelled) return;
          setSlots((prev) =>
            prev.map((s) =>
              s.camera === cam
                ? {
                    ...s,
                    url: result.url,
                    failed: !result.ok || !result.url,
                    error: result.error,
                    width: result.width,
                    height: result.height,
                  }
                : s,
            ),
          );
        } catch (e) {
          if (cancelled) return;
          setSlots((prev) =>
            prev.map((s) =>
              s.camera === cam
                ? { ...s, failed: true, error: e instanceof Error ? e.message : "decode failed" }
                : s,
            ),
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [frame, srcFile]);

  // Smooth playback loop via requestAnimationFrame; emits a fractional
  // playhead so the map marker glides between GPS points.
  useEffect(() => {
    if (!playing) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
      return;
    }
    let last = performance.now();
    let accFractional = frameIdx;
    let lastWholeFrame = frameIdx;

    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      accFractional += dt * fps;
      if (accFractional >= scan.frames.length - 1) {
        accFractional = scan.frames.length - 1;
        setPlaying(false);
        onPlayheadChange?.(accFractional);
        onFrameIdxChange(Math.floor(accFractional));
        return;
      }
      onPlayheadChange?.(accFractional);
      const whole = Math.floor(accFractional);
      if (whole !== lastWholeFrame) {
        lastWholeFrame = whole;
        onFrameIdxChange(whole);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, fps, scan.frames.length]);

  const focusSlot = slots.find((s) => s.camera === focusCam) ?? slots.find((s) => s.url) ?? slots[0];

  const jumpTo = (idx: number) => {
    const clamped = Math.max(0, Math.min(scan.frames.length - 1, idx));
    setPlaying(false);
    onFrameIdxChange(clamped);
    onPlayheadChange?.(clamped);
  };

  if (!frame) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-[5] border-t border-border bg-background/96 p-3 backdrop-blur-xl">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => jumpTo(0)}
          className="rounded border border-border bg-background/60 p-1.5 text-muted-foreground hover:text-foreground"
          title="First frame"
        >
          <SkipBack className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="flex items-center gap-1.5 rounded border border-accent/50 bg-accent/15 px-3 py-1.5 text-xs font-semibold text-accent shadow-[0_0_20px_hsl(var(--accent)/0.12)] hover:bg-accent/25"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {playing ? "Pause drive" : "Play drive"}
        </button>
        <button
          type="button"
          onClick={() => jumpTo(scan.frames.length - 1)}
          className="rounded border border-border bg-background/60 p-1.5 text-muted-foreground hover:text-foreground"
          title="Last frame"
        >
          <SkipForward className="size-3.5" />
        </button>

        <span className="ml-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
          Frame
        </span>
        <input
          type="range"
          min={0}
          max={scan.frames.length - 1}
          value={frameIdx}
          onChange={(e) => jumpTo(parseInt(e.target.value, 10))}
          className="min-w-32 flex-1 accent-[color:var(--accent)]"
        />
        <span className="font-mono text-[11px] text-foreground">
          {String(frameIdx + 1).padStart(4, "0")} / {scan.frames.length}
        </span>

        <label className="ml-2 flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          FPS
          <input
            type="number"
            min={1}
            max={30}
            value={fps}
            onChange={(e) => setFps(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            className="w-12 rounded border border-border bg-background/60 px-1 py-0.5 text-right text-foreground"
          />
        </label>

        <div className="ml-auto flex items-center gap-1 rounded border border-border bg-background/50 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("focus")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] uppercase tracking-wider ${viewMode === "focus" ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Camera className="size-3" /> Road
          </button>
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            className={`flex items-center gap-1 rounded px-2 py-1 text-[10px] uppercase tracking-wider ${viewMode === "grid" ? "bg-accent/20 text-accent" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Grid2X2 className="size-3" /> 6 Cam
          </button>
        </div>

        <span className="hidden max-w-[260px] truncate font-mono text-[10px] text-muted-foreground 2xl:inline">
          @ 0x{frame.frameStart.toString(16).toUpperCase()} · {frame.fileName}
        </span>
      </div>

      {viewMode === "focus" ? (
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px]">
          <RoadTile slot={focusSlot} large />
          <div className="grid grid-cols-3 gap-2 lg:grid-cols-2">
            {slots.map((slot) => (
              <button
                key={slot.camera}
                type="button"
                onClick={() => setFocusCam(slot.camera)}
                className={`relative aspect-[4/3] overflow-hidden rounded border text-left transition ${focusCam === slot.camera ? "border-accent shadow-[0_0_0_1px_hsl(var(--accent))]" : "border-border hover:border-accent/60"}`}
              >
                <RoadTile slot={slot} compact />
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-6 gap-2">
          {slots.map((slot) => (
            <RoadTile key={slot.camera} slot={slot} />
          ))}
        </div>
      )}
    </div>
  );
}

function RoadTile({ slot, large = false, compact = false }: { slot?: CameraSlot; large?: boolean; compact?: boolean }) {
  const cam = slot?.camera ?? 0;
  return (
    <div
      className={`relative overflow-hidden rounded border border-border bg-neutral-950 ${large ? "h-[260px]" : "aspect-[4/3]"}`}
    >
      {slot?.url && (
        <img
          src={slot.url}
          alt={`Camera ${cam}`}
          className="size-full object-cover"
          draggable={false}
        />
      )}
      {slot && !slot.url && !slot.failed && (
        <div className="absolute inset-0 grid place-items-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
          decoding road image…
        </div>
      )}
      {(!slot || slot.failed) && (
        <div className="absolute inset-0 grid place-items-center px-2 text-center font-mono text-[9px] leading-tight text-muted-foreground">
          <span>
            {slot?.error ? "decode failed" : "no data"}
            {slot?.error && !compact && (
              <span className="mt-1 block max-w-[34ch] normal-case opacity-70">{slot.error}</span>
            )}
          </span>
        </div>
      )}
      <div className="absolute left-1 top-1 flex items-center gap-1 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground backdrop-blur">
        <Waypoints className="size-3 text-accent" /> Cam {cam} {large && `· ${CAMERA_NAMES[cam]}`}
      </div>
      {slot && (
        <div className="absolute bottom-1 right-1 rounded bg-background/85 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground backdrop-blur">
          {slot.planeCount}/4 · {(slot.size / 1024).toFixed(0)} KB
        </div>
      )}
      {slot?.url && large && (
        <div className="absolute bottom-1 left-1 rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300 backdrop-blur">
          real PGR road image
        </div>
      )}
    </div>
  );
}