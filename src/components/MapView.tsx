import { type ReactElement, useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { EligibleStop } from "../domain/gtfs";
import type { OsmNode } from "../domain/osm";

const DEFAULT_STYLE = "https://tiles.openfreemap.org/styles/liberty";

type MapViewProps = {
  nodes: readonly OsmNode[];
  stops?: readonly EligibleStop[];
  selectedNodeIds?: readonly number[];
  styleUrl?: string;
};

export function MapView({
  nodes,
  stops = [],
  selectedNodeIds = [],
  styleUrl = DEFAULT_STYLE
}: MapViewProps): ReactElement {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    let disposed = false;
    void import("maplibre-gl").then((module) => {
      if (disposed || container.current === null) {
        return;
      }
      const instance = new module.Map({
        container: container.current,
        style: styleUrl,
        center: [-122.33, 47.61],
        zoom: 9
      });
      map.current = instance;
      instance.on("load", () => {
        const labelLayerId = instance
          .getStyle()
          .layers?.find((layer) => layer.type === "symbol")?.id;
        const selected = new Set(selectedNodeIds);
        const candidateFeatures = nodes.map((node) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [node.longitude, node.latitude]
          },
          properties: { id: node.id, selected: selected.has(node.id) }
        }));
        const stopFeatures = stops.map((stop) => ({
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [stop.longitude, stop.latitude]
          },
          properties: { id: stop.featureId }
        }));
        const selectedFeatures = candidateFeatures.filter(
          (feature) => feature.properties.selected
        );
        instance.addSource("gtfs-stops", {
          type: "geojson",
          data: { type: "FeatureCollection", features: stopFeatures }
        });
        instance.addSource("osm-candidates", {
          type: "geojson",
          data: { type: "FeatureCollection", features: candidateFeatures }
        });
        instance.addSource("osm-selected", {
          type: "geojson",
          data: { type: "FeatureCollection", features: selectedFeatures }
        });
        instance.addLayer(
          {
            id: "gtfs-stops",
            type: "circle",
            source: "gtfs-stops",
            paint: {
              "circle-color": "#2563eb",
              "circle-radius": 5,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2
            }
          },
          labelLayerId
        );
        instance.addLayer(
          {
            id: "osm-candidates",
            type: "circle",
            source: "osm-candidates",
            paint: {
              "circle-color": "#b45309",
              "circle-radius": 6,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 2
            }
          },
          labelLayerId
        );
        instance.addLayer(
          {
            id: "osm-selected",
            type: "circle",
            source: "osm-selected",
            paint: {
              "circle-color": "#047857",
              "circle-radius": 8,
              "circle-stroke-color": "#ffffff",
              "circle-stroke-width": 3
            }
          },
          labelLayerId
        );
      });
    });
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, [nodes, selectedNodeIds, stops, styleUrl]);

  return (
    <div className="map-shell">
      <div
        ref={container}
        className="map"
        role="img"
        aria-label="OpenStreetMap candidate map"
      />
      <p className="map-attribution">
        Basemap: OpenFreeMap Liberty. GTFS, candidate, and selected symbols are
        also listed in the review queue.
      </p>
    </div>
  );
}
