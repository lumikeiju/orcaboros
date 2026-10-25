import { type ReactElement, useEffect, useRef, useState } from "react";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  Popup as MapLibrePopup
} from "maplibre-gl";
import type { EligibleStop } from "../domain/gtfs";
import type { CandidateMatch, InitialMatch } from "../domain/matching";
import {
  elementKey,
  isOsmWay,
  type OsmElement,
  type OsmTagSet
} from "../domain/osm";
import { selectedElementRef, type FeatureReview } from "../domain/review";
import { identityTagKey } from "../domain/source-feed";

export const MAP_STYLE_URLS = {
  dark: "https://tiles.openfreemap.org/styles/fiord",
  light: "https://tiles.openfreemap.org/styles/positron"
} as const;

export const DEFAULT_MAP_CENTER: [number, number] = [-98, 39];
export const DEFAULT_MAP_ZOOM = 1.6;

const MAP_STYLE_NAMES = {
  dark: "Fiord",
  light: "Positron"
} as const;

const ATTRIBUTION_EXPANDED_CLASS = "maplibregl-compact-show";

function setAttributionExpanded(
  attribution: HTMLDetailsElement,
  expanded: boolean
): void {
  attribution.open = expanded;
  attribution.classList.toggle(ATTRIBUTION_EXPANDED_CLASS, expanded);
}

const GLOBE_PROJECTION: Parameters<MapLibreMap["setProjection"]>[0] = {
  type: [
    "interpolate",
    ["linear"],
    ["zoom"],
    10,
    "vertical-perspective",
    12,
    "mercator"
  ]
};

type Theme = keyof typeof MAP_STYLE_URLS;

type MapViewProps = {
  nodes: readonly OsmElement[];
  stops?: readonly EligibleStop[];
  matches?: ReadonlyMap<string, InitialMatch>;
  reviews?: ReadonlyMap<string, FeatureReview>;
  validStopIds?: ReadonlyMap<string, ReadonlySet<string>>;
  mappedTagsByFeature?: ReadonlyMap<string, OsmTagSet>;
  exactMatchRadiusMeters?: number;
  focusedFeatureId?: string;
  onFeatureClick?: (featureId: string) => void;
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
const EMPTY_MAPPED_TAGS: ReadonlyMap<string, OsmTagSet> = new Map();

export function shouldShowZoomNotice(zoom: number): boolean {
  return zoom < DETAIL_ZOOM;
}

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
const CANDIDATE_VISUAL = { color: "#67D9C8", shape: "cross" } as const;
/**
 * Focused-feature highlight color, shared with the review queue card
 * highlight. Read from the `--color-selection-highlight` CSS custom
 * property so both surfaces change from one place.
 */
const SELECTION_HIGHLIGHT_VARIABLE = "--color-selection-highlight";
const SELECTION_HIGHLIGHT_FALLBACK = "#67D9C8";
const ALTERNATIVE_HIGHLIGHT_VARIABLE = "--color-focus";
const ALTERNATIVE_HIGHLIGHT_FALLBACK = "#FBBF24";

function readSelectionHighlightColor(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(SELECTION_HIGHLIGHT_VARIABLE)
    .trim();
  return value.length > 0 ? value : SELECTION_HIGHLIGHT_FALLBACK;
}

function readAlternativeHighlightColor(): string {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(ALTERNATIVE_HIGHLIGHT_VARIABLE)
    .trim();
  return value.length > 0 ? value : ALTERNATIVE_HIGHLIGHT_FALLBACK;
}

type MapHighlightRole = "primary" | "alternative";

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
  context.lineWidth = 5;
  context.strokeStyle = "#ffffff";
  context.stroke();
  context.lineWidth = 3;
  context.strokeStyle = "#111827";
  context.stroke();
  if (shape === "ring") {
    context.lineWidth = 1;
    context.strokeStyle = color;
    context.stroke();
  }
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

function addFocusHaloLayer(
  instance: MapLibreMap,
  id: string,
  source: string,
  highlightRole: MapHighlightRole,
  color: string,
  labelLayerId: string | undefined
): void {
  const radii: readonly [number, number, number] =
    highlightRole === "primary" ? [10, 15, 20] : [8, 11, 15];
  instance.addLayer(
    {
      id,
      type: "circle",
      source,
      minzoom: DETAIL_ZOOM,
      filter: ["==", ["get", "highlight"], highlightRole],
      paint: {
        "circle-color": color,
        "circle-opacity": 0.18,
        "circle-stroke-color": color,
        "circle-stroke-opacity": 1,
        "circle-stroke-width": 2,
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          DETAIL_ZOOM,
          radii[0],
          14,
          radii[1],
          18,
          radii[2]
        ]
      }
    },
    labelLayerId
  );
}

function addFocusHaloLayers(
  instance: MapLibreMap,
  labelLayerId: string | undefined
): void {
  addFocusHaloLayer(
    instance,
    "map-focus-candidates-primary",
    "osm-candidates",
    "primary",
    readSelectionHighlightColor(),
    labelLayerId
  );
  addFocusHaloLayer(
    instance,
    "map-focus-candidates-alternative",
    "osm-candidates",
    "alternative",
    readAlternativeHighlightColor(),
    labelLayerId
  );
  addFocusHaloLayer(
    instance,
    "map-focus-markers",
    "map-markers",
    "primary",
    readSelectionHighlightColor(),
    labelLayerId
  );
}

type MapData = {
  nodes: readonly OsmElement[];
  stops: readonly EligibleStop[];
  matches: ReadonlyMap<string, InitialMatch>;
  reviews: ReadonlyMap<string, FeatureReview>;
  mappedTagsByFeature: ReadonlyMap<string, OsmTagSet>;
  markers: readonly MapMarker[];
  candidateNodes: readonly OsmElement[];
  focusedFeatureId: string | undefined;
  focusedCandidateNodeHighlights: ReadonlyMap<string, MapHighlightRole>;
  connectionFeatures: ReturnType<typeof focusedCandidateConnectionFeatures>;
};

type MapFeatureCollection = Parameters<GeoJSONSource["setData"]>[0];
type StopBounds = [[number, number], [number, number]];

function removedMarkerId(element: OsmElement): string {
  return `removed-${isOsmWay(element) ? elementKey(element) : element.id}`;
}

function candidateMatchesElement(
  result: InitialMatch | undefined,
  targetElementKey: string
): boolean {
  if (result?.kind === "auto-matched") {
    return elementKey(result.candidate.node) === targetElementKey;
  }
  return (
    result?.kind === "review" &&
    result.candidates.some(
      (candidate) => elementKey(candidate.node) === targetElementKey
    )
  );
}

export function getRelatedFeatureIdForOsmElement(
  element: OsmElement,
  stops: readonly EligibleStop[],
  matches: ReadonlyMap<string, InitialMatch>,
  reviews: ReadonlyMap<string, FeatureReview>,
  focusedFeatureId?: string
): string | undefined {
  const targetElementKey = elementKey(element);
  const relatedStops = stops.filter((stop) =>
    candidateMatchesElement(matches.get(stop.featureId), targetElementKey)
  );
  const focusedStop = relatedStops.find(
    (stop) => stop.featureId === focusedFeatureId
  );
  if (focusedStop !== undefined) {
    return focusedStop.featureId;
  }
  const selectedStop = relatedStops.find((stop) => {
    const review = reviews.get(stop.featureId);
    const selected =
      review === undefined ? undefined : selectedElementRef(review);
    return selected !== undefined && elementKey(selected) === targetElementKey;
  });
  return selectedStop?.featureId ?? relatedStops[0]?.featureId;
}

export function createMapPopupContent(
  title: string,
  tags: OsmTagSet,
  tagLabel: string,
  description?: string
): HTMLElement {
  const content = document.createElement("div");
  content.className = "map-feature-popup glass-scrollbar";
  content.setAttribute("role", "group");
  content.setAttribute("aria-label", `${title} tags`);

  const heading = document.createElement("h3");
  heading.textContent = title;
  content.append(heading);

  if (description !== undefined) {
    const detail = document.createElement("p");
    detail.className = "map-feature-popup-detail";
    detail.textContent = description;
    content.append(detail);
  }

  const entries = Object.entries(tags).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (entries.length === 0) {
    const emptyMessage = document.createElement("p");
    emptyMessage.textContent = "No tags.";
    content.append(emptyMessage);
    return content;
  }

  const table = document.createElement("table");
  const caption = document.createElement("caption");
  caption.textContent = tagLabel;
  table.append(caption);
  const body = document.createElement("tbody");
  for (const [key, value] of entries) {
    const row = document.createElement("tr");
    const keyCell = document.createElement("th");
    keyCell.scope = "row";
    keyCell.textContent = key;
    const valueCell = document.createElement("td");
    valueCell.textContent = value;
    row.append(keyCell, valueCell);
    body.append(row);
  }
  table.append(body);
  content.append(table);
  return content;
}

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

function candidateFeatures(
  nodes: readonly OsmElement[],
  focusedNodeHighlights: ReadonlyMap<string, MapHighlightRole>
) {
  return nodes.map((node) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [node.longitude, node.latitude]
    },
    properties: {
      id: elementKey(node),
      highlight: focusedNodeHighlights.get(elementKey(node))
    }
  }));
}

function focusedCandidateConnectionFeatures(
  stops: readonly EligibleStop[],
  candidateNodes: readonly OsmElement[],
  focusedFeatureId: string | undefined,
  focusedNodeHighlights: ReadonlyMap<string, MapHighlightRole>
) {
  if (focusedFeatureId === undefined) {
    return [];
  }
  const stop = stops.find(
    (candidate) => candidate.featureId === focusedFeatureId
  );
  const primaryCandidate = candidateNodes.find(
    (candidate) =>
      focusedNodeHighlights.get(elementKey(candidate)) === "primary"
  );
  if (stop === undefined || primaryCandidate === undefined) {
    return [];
  }
  return [
    {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [stop.longitude, stop.latitude],
          [primaryCandidate.longitude, primaryCandidate.latitude]
        ]
      },
      properties: {
        id: `${stop.featureId}:${elementKey(primaryCandidate)}`
      }
    }
  ];
}

function markerFeatures(
  markers: readonly MapMarker[],
  focusedFeatureId: string | undefined
) {
  return markers.map((marker) => ({
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [marker.longitude, marker.latitude]
    },
    properties: {
      id: marker.id,
      kind: marker.kind,
      processed: marker.processed,
      highlight: marker.id === focusedFeatureId ? "primary" : undefined
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
  nodes: readonly OsmElement[],
  validStopIds: ReadonlyMap<string, ReadonlySet<string>>
): ReadonlySet<string> {
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
      return isRemoved ? [elementKey(node)] : [];
    })
  );
}

export function buildMapMarkers(
  stops: readonly EligibleStop[],
  nodes: readonly OsmElement[],
  matches: ReadonlyMap<string, InitialMatch> = new Map(),
  reviews: ReadonlyMap<string, FeatureReview> = new Map(),
  validStopIds: ReadonlyMap<string, ReadonlySet<string>> = new Map(),
  exactMatchRadiusMeters = Number.POSITIVE_INFINITY
): { markers: readonly MapMarker[]; candidateNodes: readonly OsmElement[] } {
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
    if (removedIds.has(elementKey(node))) {
      markers.push({
        id: removedMarkerId(node),
        kind: "removed",
        processed: false,
        latitude: node.latitude,
        longitude: node.longitude
      });
    }
  });

  return {
    markers,
    candidateNodes: nodes.filter((node) => !removedIds.has(elementKey(node)))
  };
}

export function getFocusedCandidateNodeHighlights(
  focusedFeatureId: string | undefined,
  matches: ReadonlyMap<string, InitialMatch>,
  reviews: ReadonlyMap<string, FeatureReview>
): ReadonlyMap<string, MapHighlightRole> {
  if (focusedFeatureId === undefined) {
    return new Map();
  }
  const result = matches.get(focusedFeatureId);
  if (result?.kind === "auto-matched") {
    return new Map([[elementKey(result.candidate.node), "primary"]]);
  }
  if (result?.kind !== "review") {
    return new Map();
  }
  const selectedElement = selectedElementRef(
    reviews.get(focusedFeatureId) ?? {
      selectedNodeId: undefined
    }
  );
  const selectedElementKey =
    selectedElement === undefined ? undefined : elementKey(selectedElement);
  const closestCandidate = [...result.candidates].sort(
    (left, right) =>
      left.distanceMeters - right.distanceMeters ||
      elementKey(left.node).localeCompare(elementKey(right.node))
  )[0];
  const primaryCandidateKey =
    selectedElementKey ??
    (closestCandidate === undefined
      ? undefined
      : elementKey(closestCandidate.node));
  const highlights = new Map<string, MapHighlightRole>();
  for (const candidate of result.candidates) {
    const candidateKey = elementKey(candidate.node);
    highlights.set(
      candidateKey,
      candidateKey === primaryCandidateKey ? "primary" : "alternative"
    );
  }
  if (selectedElementKey !== undefined && !highlights.has(selectedElementKey)) {
    highlights.set(selectedElementKey, "primary");
  }
  return highlights;
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
  markers: readonly MapMarker[],
  focusedFeatureId: string | undefined
): void {
  updateMapSource(instance, "map-markers", {
    type: "FeatureCollection",
    features: markerFeatures(markers, focusedFeatureId)
  });
}

function updateProcessedSource(
  instance: MapLibreMap,
  markers: readonly MapMarker[],
  focusedFeatureId: string | undefined
): void {
  updateMapSource(instance, "map-processed", {
    type: "FeatureCollection",
    features: markerFeatures(
      markers.filter((marker) => marker.processed),
      focusedFeatureId
    )
  });
}

function updateCandidateSource(
  instance: MapLibreMap,
  nodes: readonly OsmElement[],
  focusedNodeHighlights: ReadonlyMap<string, MapHighlightRole>
): void {
  updateMapSource(instance, "osm-candidates", {
    type: "FeatureCollection",
    features: candidateFeatures(nodes, focusedNodeHighlights)
  });
}

function updateMatchConnectionSource(
  instance: MapLibreMap,
  features: ReturnType<typeof focusedCandidateConnectionFeatures>
): void {
  updateMapSource(instance, "map-match-connections", {
    type: "FeatureCollection",
    features
  });
}

function focusMarker(instance: MapLibreMap, marker: MapMarker): void {
  instance.flyTo({
    center: [marker.longitude, marker.latitude],
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

export function MapLegend(): ReactElement {
  const [isOpen, setIsOpen] = useState(true);

  return (
    <aside
      className="map-legend glass-pane glass-pane--level-2"
      aria-labelledby="map-legend-heading"
      onWheel={(event) => event.stopPropagation()}
    >
      <div className={`map-legend-header${isOpen ? " is-open" : ""}`}>
        <h3 id="map-legend-heading">Map legend</h3>
        <button
          type="button"
          className="map-legend-toggle glass-button glass-button--quiet"
          aria-controls="map-legend-items"
          aria-expanded={isOpen}
          aria-label={`${isOpen ? "Collapse" : "Expand"} map legend`}
          onClick={() => setIsOpen((open) => !open)}
        >
          <span className="map-legend-toggle-icon" aria-hidden="true" />
        </button>
      </div>
      <ul
        id="map-legend-items"
        className="glass-scrollbar"
        hidden={!isOpen}
        tabIndex={isOpen ? 0 : undefined}
      >
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
          Unmatched stop
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
          <span className="map-legend-marker is-candidate" aria-hidden="true" />
          OSM candidate
        </li>
        <li>
          <span
            className="map-legend-highlight is-primary"
            aria-hidden="true"
          />
          Focused stop / closest candidate
        </li>
        <li>
          <span
            className="map-legend-highlight is-alternative"
            aria-hidden="true"
          />
          Alternative candidates (2+)
        </li>
        <li>
          <span className="map-legend-connection" aria-hidden="true" />
          Focused stop-to-candidate link
        </li>
        <li>
          <span className="map-legend-processed" aria-hidden="true" />
          Reviewed
        </li>
      </ul>
    </aside>
  );
}

export function MapView({
  nodes,
  stops = [],
  matches = new Map(),
  reviews = new Map(),
  validStopIds = new Map(),
  mappedTagsByFeature = EMPTY_MAPPED_TAGS,
  exactMatchRadiusMeters = Number.POSITIVE_INFINITY,
  focusedFeatureId,
  onFeatureClick,
  styleUrl,
  theme = "dark"
}: MapViewProps): ReactElement {
  const resolvedStyleUrl = styleUrl ?? MAP_STYLE_URLS[theme];
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const mapLoaded = useRef(false);
  const attributionExpanded = useRef(true);
  const [showZoomNotice, setShowZoomNotice] = useState(false);
  const derivedMapData = buildMapMarkers(
    stops,
    nodes,
    matches,
    reviews,
    validStopIds,
    exactMatchRadiusMeters
  );
  const focusedCandidateNodeHighlights = getFocusedCandidateNodeHighlights(
    focusedFeatureId,
    matches,
    reviews
  );
  const connectionFeatures = focusedCandidateConnectionFeatures(
    stops,
    derivedMapData.candidateNodes,
    focusedFeatureId,
    focusedCandidateNodeHighlights
  );
  const mapData = useRef<MapData>({
    nodes,
    stops,
    matches,
    reviews,
    mappedTagsByFeature,
    markers: derivedMapData.markers,
    candidateNodes: derivedMapData.candidateNodes,
    focusedFeatureId,
    focusedCandidateNodeHighlights,
    connectionFeatures
  });
  const focusedFeatureIdRef = useRef(focusedFeatureId);
  const onFeatureClickRef = useRef(onFeatureClick);
  mapData.current = {
    nodes,
    stops,
    matches,
    reviews,
    mappedTagsByFeature,
    markers: derivedMapData.markers,
    candidateNodes: derivedMapData.candidateNodes,
    focusedFeatureId,
    focusedCandidateNodeHighlights,
    connectionFeatures
  };
  focusedFeatureIdRef.current = focusedFeatureId;
  onFeatureClickRef.current = onFeatureClick;

  useEffect(() => {
    let disposed = false;
    let activePopup: MapLibrePopup | undefined;
    let attributionControl: HTMLDetailsElement | null = null;
    let attributionToggle: HTMLElement | null = null;
    let handleAttributionToggle: (() => void) | undefined;
    setShowZoomNotice(false);
    mapLoaded.current = false;
    void import("maplibre-gl").then((module) => {
      const mapContainer = container.current;
      if (disposed || mapContainer === null) {
        return;
      }
      module.setWorkerUrl(maplibreWorkerUrl);
      const instance = new module.Map({
        container: mapContainer,
        style: resolvedStyleUrl,
        center: DEFAULT_MAP_CENTER,
        zoom: DEFAULT_MAP_ZOOM,
        bearing: 0,
        pitch: 0,
        dragRotate: false,
        pitchWithRotate: false,
        attributionControl: { compact: true }
      });
      map.current = instance;
      attributionControl = mapContainer.querySelector<HTMLDetailsElement>(
        ".maplibregl-ctrl-attrib"
      );
      if (attributionControl !== null) {
        setAttributionExpanded(attributionControl, attributionExpanded.current);
        attributionToggle = attributionControl.querySelector<HTMLElement>(
          ".maplibregl-ctrl-attrib-button"
        );
        handleAttributionToggle = (): void => {
          attributionExpanded.current = !attributionControl?.classList.contains(
            ATTRIBUTION_EXPANDED_CLASS
          );
        };
        attributionToggle?.addEventListener(
          "click",
          handleAttributionToggle,
          true
        );
        const keepAttributionExpanded = (): void => {
          if (attributionExpanded.current && attributionControl !== null) {
            setAttributionExpanded(attributionControl, true);
          }
        };
        instance.on("drag", keepAttributionExpanded);
      }
      instance.once("style.load", () => {
        if (disposed) {
          return;
        }
        instance.setProjection(GLOBE_PROJECTION);
      });
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
            features: markerFeatures(
              mapData.current.markers,
              mapData.current.focusedFeatureId
            )
          }
        });
        instance.addSource("map-processed", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: markerFeatures(
              mapData.current.markers.filter((marker) => marker.processed),
              mapData.current.focusedFeatureId
            )
          }
        });
        instance.addSource("osm-candidates", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: candidateFeatures(
              mapData.current.candidateNodes,
              mapData.current.focusedCandidateNodeHighlights
            )
          }
        });
        instance.addSource("map-match-connections", {
          type: "geojson",
          data: {
            type: "FeatureCollection",
            features: mapData.current.connectionFeatures
          }
        });
        addStatusHeatmapLayers(instance, labelLayerId);
        addFocusHaloLayers(instance, labelLayerId);
        instance.addLayer(
          {
            id: "map-match-connection-casing",
            type: "line",
            source: "map-match-connections",
            minzoom: DETAIL_ZOOM,
            layout: {
              "line-cap": "round",
              "line-join": "round"
            },
            paint: {
              "line-color": "#0C1519",
              "line-opacity": 0.9,
              "line-width": 5
            }
          },
          labelLayerId
        );
        instance.addLayer(
          {
            id: "map-match-connection",
            type: "line",
            source: "map-match-connections",
            minzoom: DETAIL_ZOOM,
            layout: {
              "line-cap": "round",
              "line-join": "round"
            },
            paint: {
              "line-color": readSelectionHighlightColor(),
              "line-opacity": 0.95,
              "line-width": 2.5,
              "line-dasharray": [2, 1.5]
            }
          },
          labelLayerId
        );
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
              "icon-size": [
                "interpolate",
                ["linear"],
                ["zoom"],
                DETAIL_ZOOM,
                0.75,
                14,
                0.95
              ]
            }
          },
          labelLayerId
        );
        instance.addLayer(
          {
            id: "map-processed-casing",
            type: "circle",
            source: "map-processed",
            minzoom: DETAIL_ZOOM,
            paint: {
              "circle-color": "rgba(0, 0, 0, 0)",
              "circle-radius": 10,
              "circle-stroke-color": "#111827",
              "circle-stroke-width": 4
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
              "circle-radius": 8,
              "circle-stroke-color": "#F0E442",
              "circle-stroke-width": 2
            }
          },
          labelLayerId
        );
        const markerLayerIds = MARKER_KINDS.map(
          (markerKind) => `map-marker-${markerKind}`
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
                  DETAIL_ZOOM,
                  0.7,
                  14,
                  0.85
                ]
              },
              paint: {
                "icon-opacity": [
                  "case",
                  ["boolean", ["get", "processed"], false],
                  1,
                  0.85
                ]
              }
            },
            labelLayerId
          );
        }
        const interactiveLayerIds = [
          ...markerLayerIds,
          "map-processed",
          "osm-candidates"
        ];
        const handleFeatureClick = (event: MapLayerMouseEvent): void => {
          const clickedFeature = event.features?.[0];
          const clickedId = clickedFeature?.properties?.id;
          const clickedLayer = clickedFeature?.layer.id;
          if (
            typeof clickedId !== "string" ||
            typeof clickedLayer !== "string"
          ) {
            return;
          }
          const currentData = mapData.current;
          let title: string;
          let tags: OsmTagSet;
          let tagLabel: string;
          let description: string | undefined;
          let reviewFeatureId: string | undefined;
          if (clickedLayer === "osm-candidates") {
            const element = currentData.candidateNodes.find(
              (node) => elementKey(node) === clickedId
            );
            if (element === undefined) {
              return;
            }
            title = `OSM ${isOsmWay(element) ? "way" : "node"} ${element.id}`;
            tags = element.tags;
            tagLabel = "OSM tags";
            reviewFeatureId = getRelatedFeatureIdForOsmElement(
              element,
              currentData.stops,
              currentData.matches,
              currentData.reviews,
              currentData.focusedFeatureId
            );
            const relatedStop = currentData.stops.find(
              (stop) => stop.featureId === reviewFeatureId
            );
            description =
              relatedStop === undefined
                ? "No review item is linked to this OSM element."
                : `Related stop: ${relatedStop.stopNameExpanded}`;
          } else {
            const marker = currentData.markers.find(
              (candidate) => candidate.id === clickedId
            );
            if (marker === undefined) {
              return;
            }
            reviewFeatureId = marker.id;
            if (marker.kind === "removed") {
              const element = currentData.nodes.find(
                (node) => removedMarkerId(node) === marker.id
              );
              if (element === undefined) {
                return;
              }
              title = `OSM ${isOsmWay(element) ? "way" : "node"} ${element.id}`;
              tags = element.tags;
              tagLabel = "OSM tags";
            } else {
              const stop = currentData.stops.find(
                (candidate) => candidate.featureId === marker.id
              );
              if (stop === undefined) {
                return;
              }
              title = `GTFS stop: ${stop.stopNameExpanded}`;
              tags = currentData.mappedTagsByFeature.get(stop.featureId) ?? {};
              tagLabel = "Profile-mapped tags";
            }
          }
          if (reviewFeatureId !== undefined) {
            onFeatureClickRef.current?.(reviewFeatureId);
          }
          activePopup?.remove();
          const canvasHeight = instance.getCanvas().clientHeight;
          const popupContent = createMapPopupContent(
            title,
            tags,
            tagLabel,
            description
          );
          popupContent.style.maxHeight = `${Math.max(
            96,
            Math.min(352, Math.floor(canvasHeight / 2) - 48)
          )}px`;
          activePopup = new module.Popup({
            closeButton: true,
            closeOnClick: true,
            maxWidth: "20rem",
            anchor: event.point.y > canvasHeight / 2 ? "bottom" : "top"
          })
            .setLngLat(event.lngLat)
            .setDOMContent(popupContent)
            .addTo(instance);
        };
        instance.on("click", interactiveLayerIds, handleFeatureClick);
        instance.on("mouseenter", interactiveLayerIds, () => {
          instance.getCanvas().style.cursor = "pointer";
        });
        instance.on("mouseleave", interactiveLayerIds, () => {
          instance.getCanvas().style.cursor = "";
        });
        const handleZoom = (): void => {
          setShowZoomNotice(shouldShowZoomNotice(instance.getZoom()));
        };
        instance.on("zoom", handleZoom);
        mapLoaded.current = true;
        handleZoom();
        const focusedMarker = mapData.current.markers.find(
          (marker) => marker.id === focusedFeatureIdRef.current
        );
        if (focusedMarker !== undefined) {
          focusMarker(instance, focusedMarker);
        } else {
          fitToStops(instance, mapData.current.stops);
        }
      });
    });
    return () => {
      disposed = true;
      mapLoaded.current = false;
      activePopup?.remove();
      if (attributionToggle !== null && handleAttributionToggle !== undefined) {
        attributionToggle.removeEventListener(
          "click",
          handleAttributionToggle,
          true
        );
      }
      map.current?.remove();
      map.current = null;
    };
  }, [resolvedStyleUrl]);

  useEffect(() => {
    if (mapLoaded.current && map.current !== null) {
      updateMarkerSource(
        map.current,
        mapData.current.markers,
        mapData.current.focusedFeatureId
      );
      updateProcessedSource(
        map.current,
        mapData.current.markers,
        mapData.current.focusedFeatureId
      );
      updateCandidateSource(
        map.current,
        mapData.current.candidateNodes,
        mapData.current.focusedCandidateNodeHighlights
      );
      updateMatchConnectionSource(
        map.current,
        mapData.current.connectionFeatures
      );
    }
  }, [
    exactMatchRadiusMeters,
    focusedFeatureId,
    matches,
    nodes,
    reviews,
    stops,
    validStopIds
  ]);

  useEffect(() => {
    if (mapLoaded.current && map.current !== null) {
      fitToStops(map.current, stops);
    }
  }, [stops]);

  useEffect(() => {
    if (
      !mapLoaded.current ||
      map.current === null ||
      focusedFeatureId === undefined
    ) {
      return;
    }
    const focusedMarker = derivedMapData.markers.find(
      (marker) => marker.id === focusedFeatureId
    );
    if (focusedMarker !== undefined) {
      focusMarker(map.current, focusedMarker);
    }
  }, [
    exactMatchRadiusMeters,
    focusedFeatureId,
    matches,
    nodes,
    reviews,
    stops,
    validStopIds
  ]);

  return (
    <div className="map-shell">
      <div
        ref={container}
        className="map"
        role="img"
        aria-label="OpenStreetMap candidate map"
      />
      {showZoomNotice && (
        <button
          type="button"
          className="map-zoom-notice glass-button glass-button--secondary"
          aria-label="Zoom map in to view data"
          onClick={() =>
            map.current?.zoomTo(DETAIL_ZOOM, {
              duration: 500,
              essential: true
            })
          }
        >
          Zoom in to view data
        </button>
      )}
      <MapLegend />
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
