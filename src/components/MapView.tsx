import { useEffect, useMemo, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  CircleMarker,
  useMap,
  useMapEvents,
  LayersControl,
} from "react-leaflet";
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

function ClickHandler({ onClick }: { onClick?: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(e) {
      onClick?.(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function PanTo({ pos, follow }: { pos: [number, number] | null; follow: boolean }) {
  const map = useMap();
  const raf = useRef<number | null>(null);
  useEffect(() => {
    if (!pos) return;
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      if (follow) map.panTo(pos, { animate: false, noMoveStart: true });
      else map.panTo(pos, { animate: true, duration: 0.35 });
    });
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [pos, follow, map]);
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
  onMapClick,
  currentPos,
  followCurrent = false,
}: {
  runs: Runs;
  showTrack: boolean;
  showNodes: boolean;
  smooth?: boolean;
  quality: QualitySettings;
  onStats?: (s: { source: number; rendered: number }) => void;
  onMapClick?: (lat: number, lon: number) => void;
  currentPos?: [number, number] | null;
  followCurrent?: boolean;
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

      <ClickHandler onClick={onMapClick} />
      <PanTo pos={currentPos ?? null} follow={followCurrent} />

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

      {showNodes &&
        rendered.map(({ id, decimated }, runIdx) =>
          decimated.map((p, idx) =>
            idx % Math.max(1, Math.ceil(decimated.length / 400)) === 0 ? (
              <CircleMarker
                key={`pt-${id}-${idx}`}
                center={[p.lat, p.lon]}
                radius={4}
                eventHandlers={{ click: () => onMapClick?.(p.lat, p.lon) }}
                pathOptions={{
                  color: RUN_COLORS[runIdx % RUN_COLORS.length],
                  weight: 1,
                  fillColor: "#ffffff",
                  fillOpacity: 0.85,
                }}
              />
            ) : null,
          ),
        )}

      {currentPos && (
        <>
          <CircleMarker
            center={currentPos}
            radius={followCurrent ? 18 : 13}
            pathOptions={{
              color: "#f59e0b",
              weight: 2,
              fillColor: "#f59e0b",
              fillOpacity: followCurrent ? 0.16 : 0.08,
            }}
          />
          <CircleMarker
            center={currentPos}
            radius={8}
            pathOptions={{
              color: "#ffffff",
              weight: 2,
              fillColor: "#f59e0b",
              fillOpacity: 1,
            }}
          />
        </>
      )}

      <FitBounds runs={runs} />
    </MapContainer>
  );
}
