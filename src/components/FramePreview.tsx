import { useEffect, useMemo, useState } from "react";
import type { PgrScanResult } from "@/lib/parsers";

interface Props {
  scan: PgrScanResult;
  file: File;
}

interface PlaneImg {
  camera: number;
  plane: number;
  url: string;
  size: number;
  ok: boolean;
}

export function FramePreview({ scan, file }: Props) {
  const [frameIdx, setFrameIdx] = useState(0);
  const [imgs, setImgs] = useState<PlaneImg[]>([]);

  const frame = useMemo(() => scan.frames[frameIdx], [scan, frameIdx]);

  useEffect(() => {
    if (!frame) return;
    const created: PlaneImg[] = [];
    // Render one (lowest-index) plane per camera for a 6-cam strip
    const seen = new Set<number>();
    for (const p of frame.planes) {
      if (seen.has(p.camera)) continue;
      seen.add(p.camera);
      const blob = file.slice(p.offset, p.offset + p.size, "image/jpeg");
      created.push({
        camera: p.camera,
        plane: p.plane,
        url: URL.createObjectURL(blob),
        size: p.size,
        ok: true,
      });
    }
    created.sort((a, b) => a.camera - b.camera);
    setImgs(created);
    return () => created.forEach((i) => URL.revokeObjectURL(i.url));
  }, [frame, file]);

  if (!frame) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 border-t border-border bg-background/85 p-3 backdrop-blur">
      <div className="mb-2 flex items-center gap-3">
        <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
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
        <span className="font-mono text-[10px] text-muted-foreground">
          @ 0x{frame.frameStart.toString(16).toUpperCase()}
        </span>
      </div>
      <div className="grid grid-cols-6 gap-2">
        {Array.from({ length: 6 }).map((_, cam) => {
          const img = imgs.find((i) => i.camera === cam);
          return (
            <div
              key={cam}
              className="relative aspect-[4/3] overflow-hidden rounded border border-border bg-background/60"
            >
              {img ? (
                <img
                  src={img.url}
                  alt={`Cam ${cam}`}
                  className="size-full object-cover"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = "none";
                    (e.currentTarget.nextSibling as HTMLElement).style.display = "grid";
                  }}
                />
              ) : null}
              <div
                className="absolute inset-0 hidden place-items-center text-center font-mono text-[10px] text-muted-foreground"
                style={{ display: img ? "none" : "grid" }}
              >
                {img ? "JPEG12 — decoder bound" : "no data"}
              </div>
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
