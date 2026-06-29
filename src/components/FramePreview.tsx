import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { PgrScanResult } from "@/lib/parsers";
import { decodePlaneToDataUrl } from "@/lib/jpeg12";

interface Props {
  scan: PgrScanResult;
  frameIdx: number;
  onFrameIdxChange: (idx: number) => void;
  /** Called every animation frame while playing with a fractional frame index. */
  onPlayheadChange?: (fractional: number) => void;
}

interface PlaneSlot {
  camera: number;
  size: number;
  url: string | null; // decoded dataURL or null while loading
  failed: boolean;
}

export function FramePreview({
  scan,
  frameIdx,
  onFrameIdxChange,
  onPlayheadChange,
}: Props) {
  const [slots, setSlots] = useState<PlaneSlot[]>([]);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(10);
  const rafRef = useRef<number | null>(null);

  const frame = useMemo(() => scan.frames[frameIdx], [scan, frameIdx]);
  const srcFile = useMemo(
    () => (frame ? scan.files[frame.fileIndex] : null),
    [frame, scan.files],
  );

  // Decode the 6 camera planes for the current frame.
  useEffect(() => {
    if (!frame || !srcFile) return;
    let cancelled = false;

    const seen = new Set<number>();
    const picked: { camera: number; offset: number; size: number }[] = [];
    for (const p of frame.planes) {
      if (seen.has(p.camera)) continue;
      seen.add(p.camera);
      picked.push({ camera: p.camera, offset: p.offset, size: p.size });
    }
    picked.sort((a, b) => a.camera - b.camera);

    setSlots(
      picked.map((p) => ({ camera: p.camera, size: p.size, url: null, failed: false })),
    );

    (async () => {
      for (const p of picked) {
        if (cancelled) return;
        try {
          const buf = new Uint8Array(
            await srcFile.slice(p.offset, p.offset + p.size).arrayBuffer(),
          );
          const url = await decodePlaneToDataUrl(buf);
          if (cancelled) return;
          setSlots((prev) =>
            prev.map((s) =>
              s.camera === p.camera ? { ...s, url, failed: url === null } : s,
            ),
          );
        } catch {
          if (cancelled) return;
          setSlots((prev) =>
            prev.map((s) => (s.camera === p.camera ? { ...s, failed: true } : s)),
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

  if (!frame) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-[5] border-t border-border bg-background/95 p-3 backdrop-blur">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onFrameIdxChange(0)}
          className="rounded border border-border bg-background/60 p-1.5 text-muted-foreground hover:text-foreground"
          title="First frame"
        >
          <SkipBack className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="flex items-center gap-1.5 rounded border border-accent/40 bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent/25"
        >
          {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => onFrameIdxChange(scan.frames.length - 1)}
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
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            onFrameIdxChange(v);
            onPlayheadChange?.(v);
          }}
          className="flex-1 accent-[color:var(--accent)]"
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
        <span className="font-mono text-[10px] text-muted-foreground">
          @ 0x{frame.frameStart.toString(16).toUpperCase()} · {frame.fileName}
        </span>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, cam) => {
          const slot = slots.find((s) => s.camera === cam);
          return (
            <div
              key={cam}
              className="relative aspect-[4/3] overflow-hidden rounded border border-border bg-neutral-900"
            >
              {slot?.url && (
                <img
                  src={slot.url}
                  alt={`Cam ${cam}`}
                  className="size-full object-cover"
                />
              )}
              {slot && !slot.url && !slot.failed && (
                <div className="absolute inset-0 grid place-items-center font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                  decoding…
                </div>
              )}
              {(!slot || slot.failed) && (
                <div className="absolute inset-0 grid place-items-center px-2 text-center font-mono text-[9px] leading-tight text-muted-foreground">
                  {slot ? "decode failed" : "no data"}
                </div>
              )}
              <div className="absolute left-1 top-1 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Cam {cam}
              </div>
              {slot && (
                <div className="absolute bottom-1 right-1 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                  {(slot.size / 1024).toFixed(0)} KB
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
