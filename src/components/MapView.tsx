import { useEffect } from "react";
import { MapContainer, TileLayer, Polyline, Marker, useMap, LayersControl } from "react-leaflet";
import L from "leaflet";
import type { Runs } from "@/lib/parsers";

// Fix default icon URLs for bundlers
import iconUrl from "leaflet/dist/images/marker-icon.png";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";

L.Icon.Default.mergeOptions({
  iconUrl,
  iconRetinaUrl,
  shadowUrl,
});

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

const accentColor = "#5dbeff";

export function MapView({ runs, showTrack, showNodes }: { runs: Runs; showTrack: boolean; showNodes: boolean }) {
  const runList = Object.entries(runs);
  return (
    <MapContainer
      center={[20, 0]}
      zoom={2}
      style={{ height: "100%", width: "100%" }}
      worldCopyJump
    >
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
        runList.map(([id, pts]) => (
          <Polyline
            key={id}
            positions={pts.map((p) => [p.lat, p.lon] as [number, number])}
            pathOptions={{ color: accentColor, weight: 4, opacity: 0.9 }}
          />
        ))}

      {showNodes &&
        runList.map(([id, pts]) =>
          pts.length > 0 ? (
            <Marker key={`s-${id}`} position={[pts[0].lat, pts[0].lon]} />
          ) : null,
        )}
      {showNodes &&
        runList.map(([id, pts]) =>
          pts.length > 1 ? (
            <Marker key={`e-${id}`} position={[pts[pts.length - 1].lat, pts[pts.length - 1].lon]} />
          ) : null,
        )}

      <FitBounds runs={runs} />
    </MapContainer>
  );
}
