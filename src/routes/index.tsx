import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, Map as MapIcon, Hexagon, ArrowRight, Gauge, Activity, Layers } from "lucide-react";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Runway Core — PGR Multi-Sensor Analytics Platform" },
      {
        name: "description",
        content:
          "Enterprise survey platform for LCMS pavement logs and LiDAR geospatial tracks. Parse, visualize and analyze field telemetry in the browser.",
      },
      { property: "og:title", content: "Runway Core — PGR Analytics Platform" },
      {
        property: "og:description",
        content:
          "Dual-mode survey analytics for LCMS (raw .TXT logs) and LiDAR (.KML/.KMZ tracks) with interactive geospatial mapping.",
      },
    ],
  }),
  component: Launcher,
});

const modes = [
  {
    id: "lcms",
    title: "LCMS Mode",
    subtitle: "Pavement distress & macrotexture",
    description:
      "Ingest raw LCMS continuous JSON logs. Parse NMEA GGA/RMC sentences, chainage and odometer telemetry into an interactive trajectory.",
    formats: [".TXT", "GPS_Raw*", "NMEA"],
    Icon: FileText,
  },
  {
    id: "lidar",
    title: "LiDAR Geospatial Mode",
    subtitle: "Mobile mapping & alignment",
    description:
      "Import vehicle-mounted LiDAR mission tracks from Keyhole Markup files. Supports compressed KMZ archives and multi-track playback.",
    formats: [".KML", ".KMZ"],
    Icon: MapIcon,
  },
] as const;

function Launcher() {
  return (
    <main className="relative flex min-h-screen flex-col">
      <div className="bg-grid absolute inset-0 -z-10 opacity-40" />

      <header className="flex items-center justify-between px-8 py-6">
        <div className="flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-md border border-border bg-card shadow-[var(--shadow-glow)]">
            <Hexagon className="size-5 text-accent" />
          </div>
          <div>
            <div className="text-sm font-semibold tracking-[0.18em] text-foreground">RUNWAY CORE</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              PGR Multi-Sensor Analytics · v7.0
            </div>
          </div>
        </div>
        <a
          href="https://github.com"
          className="hidden text-xs text-muted-foreground hover:text-foreground sm:block"
        >
          Documentation ↗
        </a>
      </header>

      <section className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 pb-16">
        <div className="mb-10 max-w-2xl">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <span className="size-1.5 rounded-full bg-success" />
            Engineering data environment online
          </div>
          <h1 className="text-balance text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
            Select your survey workspace.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Two precision pipelines for pavement and geospatial field data. Parse, decimate, and
            visualize multi-sensor streams entirely in your browser — no upload, no server.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          {modes.map(({ id, title, subtitle, description, formats, Icon }) => (
            <Link
              key={id}
              to="/viewer/$mode"
              params={{ mode: id }}
              className="group relative overflow-hidden rounded-xl border border-border bg-card/70 p-6 shadow-[var(--shadow-card)] transition hover:border-accent/60 hover:bg-card"
            >
              <div className="absolute right-0 top-0 size-40 -translate-y-1/2 translate-x-1/2 rounded-full bg-accent/10 blur-3xl transition group-hover:bg-accent/20" />
              <div className="relative flex items-start justify-between">
                <div className="grid size-12 place-items-center rounded-lg border border-border bg-background/60">
                  <Icon className="size-6 text-accent" />
                </div>
                <ArrowRight className="size-5 text-muted-foreground transition group-hover:translate-x-1 group-hover:text-accent" />
              </div>
              <div className="relative mt-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">
                  {subtitle}
                </div>
                <h2 className="mt-1 text-xl font-semibold text-foreground">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
              </div>
              <div className="relative mt-5 flex flex-wrap gap-1.5">
                {formats.map((f) => (
                  <span
                    key={f}
                    className="rounded border border-border bg-background/60 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                  >
                    {f}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>

        <div className="mt-12 grid grid-cols-3 gap-6 border-t border-border pt-6 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Gauge className="size-4 text-accent" />
            Strict 2-decimal telemetry
          </div>
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-accent" />
            Async non-blocking parsers
          </div>
          <div className="flex items-center gap-2">
            <Layers className="size-4 text-accent" />
            Multi-layer trajectory overlays
          </div>
        </div>
      </section>
    </main>
  );
}
