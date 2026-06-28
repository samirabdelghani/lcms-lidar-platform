import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { PgrScanResult } from "@/lib/parsers";

interface Props {
  scan: PgrScanResult;
  frameIdx: number;
  onFrameIdxChange: (idx: number) => void;
}

interface PlaneImg {
  camera: number;
  url: string;
  size: number;
}

/**
 * Draws a JPEG plane to a canvas and applies an auto-contrast stretch so dim
 * 8-bit plane payloads (which look near-black raw) become a visible monochrome
 * road image. Returns the canvas dataURL on success, or null on decode failure.
 */
async function renderPlaneAutoContrast(url: string): Promise<string | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) return resolve(null);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, w, h);
        const px = data.data;
        // Auto-levels on luminance (sample every 16th px for speed)
        let lo = 255;
        let hi = 0;
        for (let i = 0; i < px.length; i += 64) {
          const v = px[i];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        if (hi <= lo) hi = lo + 1;
        const scale = 255 / (hi - lo);
        const gamma = 0.85;
        for (let i = 0; i < px.length; i += 4) {
          let v = (px[i] - lo) * scale;
          if (v < 0) v = 0;
          else if (v > 255) v = 255;
          v = Math.pow(v / 255, gamma) * 255;
          px[i] = px[i + 1] = px[i + 2] = v;
          px[i + 3] = 255;
        }
        ctx.putImageData(data, 0, 0);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export function FramePreview({ scan, frameIdx, onFrameIdxChange }: Props) {
  const [imgs, setImgs] = useState<PlaneImg[]>([]);
  const [renders, setRenders] = useState<Record<number, string | null>>({});
  const [playing, setPlaying] = useState(false);
  const [fps, setFps] = useState(8);
  const timerRef = useRef<number | null>(null);

  const frame = useMemo(() => scan.frames[frameIdx], [scan, frameIdx]);
  const srcFile = useMemo(
    () => (frame ? scan.files[frame.fileIndex] : null),
    [frame, scan.files],
  );

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
    setRenders({});

    // Auto-contrast each plane in parallel
    let cancelled = false;
    Promise.all(
      created.map((img) =>
        renderPlaneAutoContrast(img.url).then((res) => ({ cam: img.camera, res })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const map: Record<number, string | null> = {};
      for (const r of results) map[r.cam] = r.res;
      setRenders(map);
    });

    return () => {
      cancelled = true;
      created.forEach((i) => URL.revokeObjectURL(i.url));
    };
  }, [frame, srcFile]);

  useEffect(() => {
    if (!playing) {
      if (timerRef.current) window.clearInterval(timerRef.current);
      timerRef.current = null;
      return;
    }
    timerRef.current = window.setInterval(() => {
      const next = frameIdx + 1;
      if (next >= scan.frames.length) {
        setPlaying(false);
      } else {
        onFrameIdxChange(next);
      }
    }, Math.max(50, 1000 / fps));
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [playing, fps, frameIdx, scan.frames.length, onFrameIdxChange]);

  if (!frame) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-[5] border-t border-border bg-background/90 p-3 backdrop-blur">
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
          onChange={(e) => onFrameIdxChange(parseInt(e.target.value, 10))}
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
          const rendered = renders[cam];
          // rendered === undefined → still processing; null → decode failed
          const showRaw = img && rendered === undefined;
          const showAuto = img && rendered;
          const failed = img && rendered === null;
          return (
            <div
              key={cam}
              className="relative aspect-[4/3] overflow-hidden rounded border border-border bg-neutral-900"
            >
              {showAuto && (
                <img
                  src={rendered!}
                  alt={`Cam ${cam}`}
                  className="size-full object-cover"
                />
              )}
              {showRaw && (
                <img
                  src={img!.url}
                  alt={`Cam ${cam} raw`}
                  className="size-full object-cover opacity-60"
                />
              )}
              {(failed || !img) && (
                <div className="absolute inset-0 grid place-items-center px-2 text-center font-mono text-[9px] leading-tight text-muted-foreground">
                  {img ? "12-bit baseline · decoder-bound" : "no data"}
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
