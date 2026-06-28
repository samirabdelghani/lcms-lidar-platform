import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { PgrScanResult } from "@/lib/parsers";

interface Props {
  scan: PgrScanResult;
}

interface PlaneImg {
  camera: number;
  url: string;
  size: number;
}

export function FramePreview({ scan }: Props) {
  const [frameIdx, setFrameIdx] = useState(0);
  const [imgs, setImgs] = useState<PlaneImg[]>([]);
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(8);
  const [decodeErrors, setDecodeErrors] = useState<Set<number>>(new Set());
  const timerRef = useRef<number | null>(null);

  const frame = useMemo(() => scan.frames[frameIdx], [scan, frameIdx]);
  const srcFile = useMemo(
    () => (frame ? scan.files[frame.fileIndex] : null),
    [frame, scan.files],
  );

  // Build object URLs for each camera (one plane per cam)
  useEffect(() => {
    if (!frame || !srcFile) return;
    const created: PlaneImg[] = [];
    const seen = new Set<number>();
    for (const p of frame.planes) {
      if (seen.has(p.camera)) continue;
      seen.add(p.camera);
      const blob = srcFile.slice(p.offset, p.offset + p.size, "image/jpeg");
      created.push({
        camera: p.camera,
        url: URL.createObjectURL(blob),
        size: p.size,
      });
    }
    created.sort((a, b) => a.camera - b.camera);
    setImgs(created);
    setDecodeErrors(new Set());
    return () => created.forEach((i) => URL.revokeObjectURL(i.url));
  }, [frame, srcFile]);

  // Play loop
  useEffect(() => {
    if (!playing) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = window.setInterval(() => {
      setFrameIdx((i) => {
        const next = i + 1;
        if (next >= scan.frames.length) {
          setPlaying(false);
          return i;
        }
        return next;
      });
    }, Math.max(50, 1000 / fps));
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [playing, fps, scan.frames.length]);

  if (!frame) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-[5] border-t border-border bg-background/90 p-3 backdrop-blur">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFrameIdx(0)}
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
          onClick={() => setFrameIdx(scan.frames.length - 1)}
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
          onChange={(e) => setFrameIdx(parseInt(e.target.value, 10))}
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
          const img = imgs.find((i) => i.camera === cam);
          const failed = decodeErrors.has(cam);
          return (
            <div
              key={cam}
              className="relative aspect-[4/3] overflow-hidden rounded border border-border bg-black/40"
            >
              {img && !failed && (
                <img
                  src={img.url}
                  alt={`Cam ${cam}`}
                  className="size-full object-cover"
                  onError={() =>
                    setDecodeErrors((s) => {
                      const next = new Set(s);
                      next.add(cam);
                      return next;
                    })
                  }
                />
              )}
              {(failed || !img) && (
                <div className="absolute inset-0 grid place-items-center px-2 text-center font-mono text-[9px] leading-tight text-muted-foreground">
                  {img
                    ? "JPEG12 payload · browser cannot decode 12-bit baseline. Export raw plane to view in external tool."
                    : "no data"}
                </div>
              )}
              <div className="absolute left-1 top-1 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                Cam {cam}
              </div>
              {img && (
                <div className="absolute bottom-1 right-1 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground">
                  {(img.size / 1024).toFixed(0)} KB
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
