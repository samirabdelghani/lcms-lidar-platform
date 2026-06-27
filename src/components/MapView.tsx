import { useEffect, useMemo } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap, LayersControl } from "react-leaflet";
import L from "leaflet";
import { buildSmoothedSegments, decimateGpsPoints, type Runs } from "@/lib/parsers";

// Fix default icon URLs for bundlers
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl });

function FitBounds({ runs }: { runs: Runs }) {
  const map = useMap();
  useEffect(() => {
    const pts = Object.values(runs).flat();
    if (!pts.length) return;
    const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lon] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
  }, [runs, map]);
  return null;
}

const RUN_COLORS = [
  "#5dbeff", "#7c4dff", "#00c896", "#f5a623",
  "#ff4757", "#22d3ee", "#a78bfa", "#facc15",
];

export interface QualitySettings {
  maxPoints: number;
  steps: number;
  maxGapM: number;
}

export function MapView({
  runs,
  showTrack,
  showNodes,
  smooth = true,
  quality,
  onStats,
}: {
  runs: Runs;
  showTrack: boolean;
  showNodes: boolean;
  smooth?: boolean;
  quality: QualitySettings;
  onStats?: (s: { source: number; rendered: number }) => void;
}) {
  const runList = Object.entries(runs);

  const rendered = useMemo(() => {
    return runList.map(([id, pts]) => {
      const decimated = decimateGpsPoints(pts, quality.maxPoints);
      const segments: [number, number][][] = smooth
        ? buildSmoothedSegments(decimated, quality.maxGapM, quality.steps)
        : [decimated.map((p) => [p.lat, p.lon] as [number, number])];
      return { id, pts, decimated, segments };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs, smooth, quality.maxPoints, quality.steps, quality.maxGapM]);

  useEffect(() => {
    const source = rendered.reduce((a, r) => a + r.pts.length, 0);
    const renderedPts = rendered.reduce(
      (a, r) => a + r.segments.reduce((b, s) => b + s.length, 0),
      0,
    );
    onStats?.({ source, rendered: renderedPts });
  }, [rendered, onStats]);

  return (
    <MapContainer center={[20, 0]} zoom={2} style={{ height: "100%", width: "100%" }} worldCopyJump>
      <LayersControl position="topright">
        <LayersControl.BaseLayer checked name="Satellite">
          <TileLayer
            attribution="&copy; Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Streets">
          <TileLayer
            attribution="&copy; OpenStreetMap"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Dark">
          <TileLayer
            attribution="&copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            maxZoom={19}
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      {showTrack &&
        rendered.map(({ id, segments }, runIdx) =>
          segments.map((seg, segIdx) => (
            <Polyline
              key={`${id}-${segIdx}`}
              positions={seg}
              pathOptions={{
                color: RUN_COLORS[runIdx % RUN_COLORS.length],
                weight: 4,
                opacity: 0.9,
              }}
            />
          )),
        )}

      {showNodes &&
        rendered.map(({ id, pts }) =>
          pts.length > 0 ? (
            <Marker key={`s-${id}`} position={[pts[0].lat, pts[0].lon]} />
          ) : null,
        )}
      {showNodes &&
        rendered.map(({ id, pts }) =>
          pts.length > 1 ? (
            <Marker
              key={`e-${id}`}
              position={[pts[pts.length - 1].lat, pts[pts.length - 1].lon]}
            />
          ) : null,
        )}

      <FitBounds runs={runs} />
    </MapContainer>
  );
}
