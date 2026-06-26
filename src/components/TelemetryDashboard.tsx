import { Activity, Gauge, MapPin, Route } from "lucide-react";

interface Props {
  chainage_m: number;
  speed_kh: number;
  distance_km: number;
  rate_hz: number;
}

const metrics = (p: Props) => [
  { label: "Current Chainage", value: p.chainage_m.toFixed(2), unit: "m", Icon: MapPin },
  { label: "Survey Speed", value: p.speed_kh.toFixed(2), unit: "km/h", Icon: Gauge },
  { label: "Total Displacement", value: p.distance_km.toFixed(2), unit: "km", Icon: Route },
  { label: "Acquisition Rate", value: p.rate_hz.toFixed(2), unit: "Hz", Icon: Activity },
];

export function TelemetryDashboard(props: Props) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {metrics(props).map(({ label, value, unit, Icon }) => (
        <div key={label} className="metric-card">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {label}
            </span>
            <Icon className="size-4 text-accent" />
          </div>
          <div className="mt-2 flex items-baseline gap-1.5 font-mono">
            <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
            <span className="text-xs text-muted-foreground">{unit}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
