import { type ReactElement, useEffect, useRef } from "react";
import type { GeoJSONSource, Map as MapLibreMap } from "maplibre-gl";
import type { EligibleStop } from "../domain/gtfs";
import type { CandidateMatch, InitialMatch } from "../domain/matching";
import type { OsmNode } from "../domain/osm";
import type { FeatureReview } from "../domain/review";
import { identityTagKey } from "../domain/source-feed";

export const MAP_STYLE_URLS = {
  dark: "https://tiles.openfreemap.org/styles/fiord",
  light: "https://tiles.openfreemap.org/styles/positron"
} as const;

const MAP_STYLE_NAMES = {
  dark: "Fiord",
  light: "Positron"
} as const;

type Theme = keyof typeof MAP_STYLE_URLS;

type MapViewProps = {
  nodes: readonly OsmNode[];
  stops?: readonly EligibleStop[];
  matches?: ReadonlyMap<string, InitialMatch>;
  reviews?: ReadonlyMap<string, FeatureReview>;
  validStopIds?: ReadonlyMap<string, ReadonlySet<string>>;
  exactMatchRadiusMeters?: number;
  focusedStopId?: string;
  styleUrl?: string;
  theme?: Theme;
};

export type MapMarkerKind = "matched" | "moved" | "new" | "removed" | "pending";

export type MapMarker = {
  id: string;
  kind: MapMarkerKind;
  processed: boolean;
  latitude: number;
  longitude: number;
};

const MARKER_KINDS: readonly MapMarkerKind[] = [
  "matched",
  "moved",
  "new",
  "removed",
  "pending"
];
const HEATMAP_KINDS: readonly MapMarkerKind[] = [
  "matched",
  "moved",
  "new",
  "removed"
];
const DETAIL_ZOOM = 11;

type MarkerShape =
  "circle" | "diamond" | "ring" | "square" | "triangle" | "cross";

const MARKER_VISUALS: Readonly<
  Record<MapMarkerKind, { color: string; shape: MarkerShape }>
> = {
  matched: { color: "#4477AA", shape: "circle" },
  moved: { color: "#66CCEE", shape: "triangle" },
  new: { color: "#CCBB44", shape: "square" },
  removed: { color: "#AA3377", shape: "diamond" },
  pending: { color: "#94A3B8", shape: "ring" }
};
const CANDIDATE_VISUAL = { color: "#94A3B8", shape: "cross" } as const;
type HeatmapColor = {
  low: string;
  medium: string;
  high: string;
};
const HEATMAP_COLORS: Readonly<Record<MapMarkerKind, HeatmapColor>> = {
  matched: {
    low: "rgba(68, 119, 170, 0)",
    medium: "rgba(68, 119, 170, 0.24)",
    high: "rgba(68, 119, 170, 0.68)"
  },
  moved: {
    low: "rgba(102, 204, 238, 0)",
    medium: "rgba(102, 204, 238, 0.24)",
    high: "rgba(102, 204, 238, 0.68)"
  },
  new: {
    low: "rgba(204, 187, 68, 0)",
    medium: "rgba(204, 187, 68, 0.24)",
    high: "rgba(204, 187, 68, 0.68)"
  },
  removed: {
    low: "rgba(170, 51, 119, 0)",
    medium: "rgba(170, 51, 119, 0.24)",
    high: "rgba(170, 51, 119, 0.68)"
  },
  pending: {
    low: "rgba(148, 163, 184, 0)",
    medium: "rgba(148, 163, 184, 0.18)",
    high: "rgba(148, 163, 184, 0.46)"
  }
};

function createMarkerImage(color: string, shape: MarkerShape): ImageData {
  const size = 22;
  const center = size / 2;
  const radius = 5.5;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("The map marker canvas could not be created");
  }
  context.translate(center, center);
  context.beginPath();
  if (shape === "circle") {
    context.arc(0, 0, radius, 0, Math.PI * 2);
  } else if (shape === "diamond") {
    context.moveTo(0, -radius);
    context.lineTo(radius, 0);
    context.lineTo(0, radius);
    context.lineTo(-radius, 0);
    context.closePath();
  } else if (shape === "square") {
    context.rect(-radius, -radius, radius * 2, radius * 2);
  } else if (shape === "triangle") {
    context.moveTo(0, -radius);
    context.lineTo(radius, radius);
    context.lineTo(-radius, radius);
    context.closePath();
  } else if (shape === "ring") {
    context.arc(0, 0, radius, 0, Math.PI * 2);
  } else {
    context.rect(-radius * 0.35, -radius, radius * 0.7, radius * 2);
    context.rect(-radius, -radius * 0.35, radius * 2, radius * 0.7);
  }
  context.lineJoin = "round";
  if (shape !== "ring") {
    context.fillStyle = color;
    context.fill();
  }
  context.lineWidth = 3;
  context.strokeStyle = "#111827";
  context.stroke();
  context.lineWidth = 1;
  context.strokeStyle = "#ffffff";
  context.stroke();
  return context.getImageData(0, 0, size, size);
}

function addMarkerImages(instance: MapLibreMap): void {
  for (const markerKind of MARKER_KINDS) {
    const imageId = `map-marker-${markerKind}`;
    if (!instance.hasImage(imageId)) {
      const visual = MARKER_VISUALS[markerKind];
      instance.addImage(
        imageId,
        createMarkerImage(visual.color, visual.shape),
        { pixelRatio: 1 }
      );
    }
  }
  if (!instance.hasImage("map-marker-candidate")) {
    instance.addImage(
      "map-marker-candidate",
      createMarkerImage(CANDIDATE_VISUAL.color, CANDIDATE_VISUAL.shape),
      { pixelRatio: 1 }
    );
  }
}

function addStatusHeatmapLayers(
  instance: MapLibreMap,
  labelLayerId: string | undefined
): void {
  for (const markerKind of HEATMAP_KINDS) {
    const colors = HEATMAP_COLORS[markerKind];
    instance.addLayer(
      {
        id: `map-heat-${markerKind}`,
        type: "heatmap",
        source: "map-markers",
        maxzoom: DETAIL_ZOOM,
        filter: ["==", ["get", "kind"], markerKind],
        paint: {
          "heatmap-weight": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            0.55,
            10,
            1
          ],
          "heatmap-intensity": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            0.8,
            10,
            1.25
          ],
          "heatmap-color": [
            "interpolate",
            ["linear"],
            ["heatmap-density"],
            0,
            colors.low,
            0.2,
            colors.medium,
            0.65,
            colors.high,
            1,
            colors.high
          ],
          "heatmap-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            0,
            10,
            6,
            18,
            10,
            28
          ],
          "heatmap-opacity": 0.64
        }
      },
      labelLayerId
    );
  }
}

type MapData = {
  nodes: readonly OsmNode[];
  stops: readonly EligibleStop[];
  markers: readonly MapMarker[];
  candidateNodes: readonly OsmNode[];
};

type MapFeatureCollection = Parameters<GeoJSONSource["setData"]>[0];
type StopBounds = [[number, number], [number, number]];

export function getStopBounds(
  stops: readonly EligibleStop[]
): StopBounds | undefined {
  if (stops.length === 0) {
    return undefined;
  }
  let minLongitude = stops[0].longitude;
  let maxLongitude = stops[0].longitude;
  let minLatitude = stops[0].latitude;
  let maxLatitude = stops[0].latitude;
  for (const stop of stops.slice(1)) {
    minLongitude = Math.min(minLongitude, stop.longitude);
    maxLongitude = Math.max(maxLongitude, stop.longitude);
    minLatitude = Math.min(minLatitude, stop.latitude);
    maxLatitude = Math.max(maxLatitude, stop.latitude);
  }
  return [
    [minLongitude, minLatitude],
    [maxLongitude, maxLatitude]
  ];
}

function candidateFeatures(nodes: readonly OsmNode[]) {
  return nodes.map((node) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [node.longitude, node.latitude]
    },
    properties: { id: node.id }
  }));
}

function markerFeatures(markers: readonly MapMarker[]) {
  return markers.map((marker) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [marker.longitude, marker.latitude]
    },
    properties: {
      id: marker.id,
      kind: marker.kind,
      processed: marker.processed
    }
  }));
}

function exactIdentityCandidate(
  result: InitialMatch | undefined
): CandidateMatch | undefined {
  if (result?.kind === "auto-matched") {
    return result.candidate.exactIdentity ? result.candidate : undefined;
  }
  if (result?.kind === "review") {
    return result.candidates.find((candidate) => candidate.exactIdentity);
  }
  return undefined;
}

function removedNodeIds(
  nodes: readonly OsmNode[],
  validStopIds: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlySet<number> {
  const identityKeys = new Map(
    [...validStopIds.keys()].map((sourceFeedId) => [
      identityTagKey(sourceFeedId),
      sourceFeedId
    ])
  );
  return new Set(
    nodes.flatMap((node) => {
      const isRemoved = Object.entries(node.tags).some(([key, value]) => {
        const sourceFeedId = identityKeys.get(key);
        return (
          sourceFeedId !== undefined &&
          !validStopIds.get(sourceFeedId)?.has(value)
        );
      });
      return isRemoved ? [node.id] : [];
    })
  );
}

export function buildMapMarkers(
  stops: readonly EligibleStop[],
  nodes: readonly OsmNode[],
  matches: ReadonlyMap<string, InitialMatch> = new Map(),
  reviews: ReadonlyMap<string, FeatureReview> = new Map(),
  validStopIds: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  exactMatchRadiusMeters = Number.POSITIVE_INFINITY
): { markers: readonly MapMarker[]; candidateNodes: readonly OsmNode[] } {
  const markers: MapMarker[] = [];

  for (const stop of stops) {
    const review = reviews.get(stop.featureId);
    const result = matches.get(stop.featureId);
    const exactCandidate = exactIdentityCandidate(matches.get(stop.featureId));
    const isMoved =
      exactCandidate !== undefined &&
      exactCandidate.distanceMeters > exactMatchRadiusMeters;
    const kind: MapMarkerKind =
      result === undefined
        ? matches.size === 0 && nodes.length === 0
          ? "pending"
          : "new"
        : result.kind === "no-candidates"
          ? "new"
          : isMoved
            ? "moved"
            : "matched";
    markers.push({
      id: stop.featureId,
      kind,
      processed: review?.state !== undefined && review.state !== "unreviewed",
      latitude: stop.latitude,
      longitude: stop.longitude
    });
  }

  const removedIds = removedNodeIds(nodes, validStopIds);
  nodes.forEach((node) => {
    if (removedIds.has(node.id)) {
      markers.push({
        id: `removed-${node.id}`,
        kind: "removed",
        processed: false,
        latitude: node.latitude,
        longitude: node.longitude
      });
    }
  });

  return {
    markers,
    candidateNodes: nodes.filter((node) => !removedIds.has(node.id))
  };
}

function updateMapSource(
  instance: MapLibreMap,
  sourceId: string,
  sourceData: MapFeatureCollection
): void {
  const source = instance.getSource(sourceId);
  if (source?.type === "geojson") {
    (source as GeoJSONSource).setData(sourceData);
  }
}

function updateMarkerSource(
  instance: MapLibreMap,
  markers: readonly MapMarker[]
): void {
  updateMapSource(instance, "map-markers", {
    type: "FeatureCollection",
    features: markerFeatures(markers)
  });
}

function updateProcessedSource(
  instance: MapLibreMap,
  markers: readonly MapMarker[]
): void {
  updateMapSource(instance, "map-processed", {
    type: "FeatureCollection",
    features: markerFeatures(markers.filter((marker) => marker.processed))
  });
}

function updateCandidateSource(
  instance: MapLibreMap,
  nodes: readonly OsmNode[]
): void {
  updateMapSource(instance, "osm-candidates", {
    type: "FeatureCollection",
    features: candidateFeatures(nodes)
  });
}

function focusStop(instance: MapLibreMap, stop: EligibleStop): void {
  instance.flyTo({
    center: [stop.longitude, stop.latitude],
    zoom: Math.max(instance.getZoom(), 15),
    duration: 700,
    essential: true
  });
}

function fitToStops(
  instance: MapLibreMap,
  stops: readonly EligibleStop[]
): void {
  const bounds = getStopBounds(stops);
  if (bounds === undefined) {
    return;
  }
  const [[minLongitude, minLatitude], [maxLongitude, maxLatitude]] = bounds;
  if (minLongitude === maxLongitude && minLatitude === maxLatitude) {
    instance.flyTo({
      center: [minLongitude, minLatitude],
      zoom: 14,
      duration: 500,
      essential: true
    });
    return;
  }
  instance.fitBounds(bounds, {
    padding: 48,
    maxZoom: 14,
    duration: 500,
    essential: true
  });
}

export function MapView({
  nodes,
  stops = [],
  matches = new Map(),
  reviews = new Map(),
  validStopIds = new Map(),
  exactMatchRadiusMeters = Number.POSITIVE_INFINITY,
  focusedStopId,
  styleUrl,
  theme = "dark"
}: MapViewProps): ReactElement {
  const resolvedStyleUrl = styleUrl ?? MAP_STYLE_URLS[theme];
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const mapLoaded = useRef(false);
  const derivedMapData = buildMapMarkers(
    stops,
    nodes,
    matches,
    reviews,
    validStopIds,
    exactMatchRadiusMeters
  );
  const mapData = useRef<MapData>({
    nodes,
    stops,
    markers: derivedMapData.markers,
    candidateNodes: derivedMapData.candidateNodes
  });
  const focusedStopIdRef = useRef(focusedStopId);
  mapData.current = {
    nodes,
    stops,
    markers: derivedMapData.markers,
    candidateNodes: derivedMapData.candidateNodes
  };
  focusedStopIdRef.current = focusedStopId;

  useEffect(() => {
    let disposed = false;
    mapLoaded.current = false;
    void import("maplibre-gl").then((module) => {
      if (disposed || container.current === null) {
        return;
      }
      const instance = new module.Map({
        container: container.current,
        style: resolvedStyleUrl,
        center: [-122.33, 47.61],
        zoom: 9,
        dragRotate: false,
        pitchWithRotate: false
      });
      map.current = instance;
      instance.on("load", () => {
        if (disposed) {
          return;
        }
        const labelLayerId = instance
          .getStyle()
          .layers?.find((layer) => layer.type === "symbol")?.id;
        addMarkerImages(instance);
        instance.addSource("map-markers", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: markerFeatures(mapData.current.markers)
          }
        });
        instance.addSource("map-processed", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: markerFeatures(
              mapData.current.markers.filter((marker) => marker.processed)
            )
          }
        });
        instance.addSource("osm-candidates", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: candidateFeatures(mapData.current.candidateNodes)
          }
        });
        addStatusHeatmapLayers(instance, labelLayerId);
        instance.addLayer(
          {
            id: "osm-candidates",
            type: "symbol",
            source: "osm-candidates",
            minzoom: DETAIL_ZOOM,
            layout: {
              "icon-image": "map-marker-candidate",
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
              "icon-size": 0.4
            }
          },
          labelLayerId
        );
        instance.addLayer(
          {
            id: "map-processed",
            type: "circle",
            source: "map-processed",
            minzoom: DETAIL_ZOOM,
            paint: {
              "circle-color": "rgba(0, 0, 0, 0)",
              "circle-radius": 9,
              "circle-stroke-color": "#F0E442",
              "circle-stroke-width": 2
            }
          },
          labelLayerId
        );
        for (const markerKind of MARKER_KINDS) {
          instance.addLayer(
            {
              id: `map-marker-${markerKind}`,
              type: "symbol",
              source: "map-markers",
              minzoom: DETAIL_ZOOM,
              filter: ["==", ["get", "kind"], markerKind],
              layout: {
                "icon-image": `map-marker-${markerKind}`,
                "icon-allow-overlap": true,
                "icon-ignore-placement": true,
                "icon-size": [
                  "interpolate",
                  ["linear"],
                  ["zoom"],
                  8,
                  0.5,
                  14,
                  0.8
                ]
              },
              paint: {
                "icon-opacity": [
                  "case",
                  ["boolean", ["get", "processed"], false],
                  1,
                  0.62
                ]
              }
            },
            labelLayerId
          );
        }
        mapLoaded.current = true;
        const focusedStop = mapData.current.stops.find(
          (stop) => stop.featureId === focusedStopIdRef.current
        );
        if (focusedStop !== undefined) {
          focusStop(instance, focusedStop);
        } else {
          fitToStops(instance, mapData.current.stops);
        }
      });
    });
    return () => {
      disposed = true;
      mapLoaded.current = false;
      map.current?.remove();
      map.current = null;
    };
  }, [resolvedStyleUrl]);

  useEffect(() => {
    if (mapLoaded.current && map.current !== null) {
      updateMarkerSource(map.current, mapData.current.markers);
      updateProcessedSource(map.current, mapData.current.markers);
      updateCandidateSource(map.current, mapData.current.candidateNodes);
    }
  }, [exactMatchRadiusMeters, matches, nodes, reviews, stops, validStopIds]);

  useEffect(() => {
    if (mapLoaded.current && map.current !== null) {
      fitToStops(map.current, stops);
    }
  }, [stops]);

  useEffect(() => {
    if (
      !mapLoaded.current ||
      map.current === null ||
      focusedStopId === undefined
    ) {
      return;
    }
    const focusedStop = stops.find((stop) => stop.featureId === focusedStopId);
    if (focusedStop !== undefined) {
      focusStop(map.current, focusedStop);
    }
  }, [focusedStopId, stops]);

  return (
    <div className="map-shell">
      <div
        ref={container}
        className="map"
        role="img"
        aria-label="OpenStreetMap candidate map"
      />
      <aside className="map-legend" aria-labelledby="map-legend-heading">
        <h3 id="map-legend-heading">Map legend</h3>
        <ul>
          <li>
            <span className="map-legend-marker is-matched" aria-hidden="true" />
            Match found
          </li>
          <li>
            <span className="map-legend-marker is-moved" aria-hidden="true" />
            Moved
          </li>
          <li>
            <span className="map-legend-marker is-new" aria-hidden="true" />
            No candidate
          </li>
          <li>
            <span className="map-legend-marker is-removed" aria-hidden="true" />
            Removed
          </li>
          <li>
            <span className="map-legend-marker is-pending" aria-hidden="true" />
            Pending
          </li>
          <li>
            <span
              className="map-legend-marker is-candidate"
              aria-hidden="true"
            />
            Candidate
          </li>
          <li>
            <span className="map-legend-processed" aria-hidden="true" />
            Processed
          </li>
        </ul>
      </aside>
      <p className="map-attribution">
        Basemap:{" "}
        {styleUrl === undefined
          ? `OpenFreeMap ${MAP_STYLE_NAMES[theme]}`
          : "Custom MapLibre style"}
        . Status and candidate symbols are also listed in the review queue.
      </p>
    </div>
  );
}
