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
    <div className=