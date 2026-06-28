import { useState } from "react";
import { Gauge } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { QualitySettings } from "@/components/MapView";

interface Props {
  value: QualitySettings;
  smooth: boolean;
  onSmoothChange: (v: boolean) => void;
  onChange: (v: QualitySettings) => void;
  stats: { source: number; rendered: number };
}

const PRESETS: Record<string, QualitySettings & { smooth: boolean }> = {
  Performance: { maxPoints: 1500, steps: 4, maxGapM: 50, smooth: false },
  Balanced:    { maxPoints: 5000, steps: 8, maxGapM: 50, smooth: true },
  Quality:     { maxPoints: 15000, steps: 16, maxGapM: 80, smooth: true },
};

export function QualityMenu({ value, smooth, onSmoothChange, onChange, stats }: Props) {
  const [open, setOpen] = useState(false);
  const reduction =
    stats.source > 0 ? Math.max(0, 100 - (stats.rendered / stats.source) * 100) : 0;

  return (
    <div className="relative">
      <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)}>
        <Gauge className="size-4" />
        Quality
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-[1000]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-[1001] mt-2 w-80 rounded-md border border-border bg-popover p-3 shadow-[var(--shadow-glow)]">
            <div className="mb-3 flex gap-1">
              {Object.entries(PRESETS).map(([name, p]) => (
                <button
                  key={name}
                  onClick={() => {
                    onSmoothChange(p.smooth);
                    onChange({ maxPoints: p.maxPoints, steps: p.steps, maxGapM: p.maxGapM });
                  }}
                  className="flex-1 rounded border border-border bg-background/60 px-2 py-1 text-[11px] uppercase tracking-wider hover:bg-accent/10"
                >
                  {name}
                </button>
              ))}
            </div>

            <Slider
              label="Decimation cap"
              hint="Max points per run before smoothing"
              min={500}
              max={20000}
              step={100}
              value={value.maxPoints}
              format={(v) => `${v.toLocaleString()} pts`}
              onChange={(v) => onChange({ ...value, maxPoints: v })}
            />
            <Slider
              label="Smoothing steps"
              hint="Catmull-Rom interpolations per span"
              min={1}
              max={32}
              step={1}
              value={value.steps}
              format={(v) => `${v}×`}
              onChange={(v) => onChange({ ...value, steps: v })}
            />
            <Slider
              label="Gap threshold"
              hint="Split segments above this distance"
              min={10}
              max={500}
              step={5}
              value={value.maxGapM}
              format={(v) => `${v} m`}
              onChange={(v) => onChange({ ...value, maxGapM: v })}
            />

            <label className="mt-2 flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-accent/10">
              <input
                type="checkbox"
                checked={smooth}
                onChange={(e) => onSmoothChange(e.target.checked)}
                className="accent-[color:var(--accent)]"
              />
              Apply Catmull-Rom smoothing
            </label>

            <div className="mt-3 rounded border border-border bg-background/60 p-2 font-mono text-[10px] text-muted-foreground">
              <div className="flex justify-between">
                <span>source pts</span>
                <span className="text-foreground">{stats.source.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>rendered</span>
                <span className="text-foreground">{stats.rendered.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span>reduction</span>
                <span className="text-accent">{reduction.toFixed(1)}%</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Slider({
  label, hint, min, max, step, value, format, onChange,
}: {
  label: string; hint: string; min: number; max: number; step: number;
  value: number; format: (v: number) => string; onChange: (v: number) => void;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-medium text-foreground">{label}</span>
        <span className="font-mono text-[11px] text-accent">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-[color:var(--accent)]"
      />
      <div className="mt-0.5 text-[10px] text-muted-foreground">{hint}</div>
    </div>
  );
}
