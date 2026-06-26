import { useEffect, useRef } from "react";

export interface LogEntry {
  ts: string;
  text: string;
  level?: "info" | "success" | "warn" | "error";
}

const levelColor: Record<NonNullable<LogEntry["level"]>, string> = {
  info: "text-muted-foreground",
  success: "text-[color:var(--success)]",
  warn: "text-[color:var(--warning)]",
  error: "text-[color:var(--destructive)]",
};

export function Console({ entries }: { entries: LogEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [entries]);
  return (
    <div
      ref={ref}
      className="h-full overflow-auto rounded-md border border-border bg-background/60 p-3 font-mono text-xs leading-relaxed"
    >
      {entries.length === 0 ? (
        <div className="text-muted-foreground">[ system idle ]</div>
      ) : (
        entries.map((e, i) => (
          <div key={i} className="flex gap-2">
            <span className="text-accent/70">[{e.ts}]</span>
            <span className={levelColor[e.level ?? "info"]}>{e.text}</span>
          </div>
        ))
      )}
    </div>
  );
}
