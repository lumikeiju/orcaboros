import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMapPopupContent,
  getFocusedCandidateNodeHighlights,
  getPopupAnchorAwayFromRelatedFeature,
  getRelatedFeatureIdForOsmElement,
  MapLegend,
  MapView
} from "../../src/components/MapView";
import type { EligibleStop } from "../../src/domain/gtfs";
import type { CandidateMatch, InitialMatch } from "../../src/domain/matching";
import { elementKey, type OsmNode } from "../../src/domain/osm";
import {
  applyReviewAction,
  type FeatureReview,
  type ReviewAction
} from "../../src/domain/review";

const maplibreState = vi.hoisted(() => ({
  calls: [] as string[],
  maps: [] as Array<{
    layers: string[];
    emitClick: (layerId: string, id: string) => void;
    emitMouseMove: (longitude: number, latitude: number) => void;
  }>,
  queryFeatures: [] as Array<{
    geometry: { type: "Point"; coordinates: [number, number] };
    properties: { id: string };
  }>,
  projectedCoordinates: new globalThis.Map<string, { x: number; y: number }>(),
  sourceData: new globalThis.Map<string, unknown>(),
  layerSpecs: new globalThis.Map<string, unknown>(),
  workerUrls: [] as string[],
  popups: [] as Array<{
    content: HTMLElement | undefined;
    options: { anchor?: string; closeButton?: boolean; maxWidth?: string };
    removed: boolean;
  }>
}));

vi.mock("maplibre-gl", () => {
  class MockMap {
    layers: string[] = [];
    private readonly handlers: Array<{
      event: string;
      layers: readonly string[];
      handler: (event: unknown) => void;
    }> = [];
    private readonly sources = new globalThis.Map<
      string,
      { type: "geojson"; setData: (data: unknown) => void }
    >();

    constructor() {
      maplibreState.calls.push("map");
      maplibreState.maps.push(this);
    }

    once(): void {}

    on(
      event: string,
      layersOrHandler: string[] | ((event: unknown) => void),
      listener?: (event: unknown) => void
    ): void {
      const layers = Array.isArray(layersOrHandler) ? layersOrHandler : [];
      const handler = Array.isArray(layersOrHandler)
        ? listener
        : layersOrHandler;
      if (handler === undefined) {
        return;
      }
      this.handlers.push({ event, layers, handler });
      if (event === "load") {
        setTimeout(() => handler({}), 0);
      }
    }

    emitClick(layerId: string, id: string): void {
      const listener = this.handlers.find(
        (entry) => entry.event === "click" && entry.layers.includes(layerId)
      );
      if (listener === undefined) {
        throw new Error(`No click listener for ${layerId}`);
      }
      listener.handler({
        features: [{ layer: { id: layerId }, properties: { id } }],
        point: { x: 200, y: 300 },
        lngLat: { lng: -122.2, lat: 48.014 }
      });
    }

    emitMouseMove(longitude: number, latitude: number): void {
      const listener = this.handlers.find(
        (entry) => entry.event === "mousemove" && entry.layers.length === 0
      );
      if (listener === undefined) {
        throw new Error("No map mousemove listener");
      }
      listener.handler({
        point: { x: 200, y: 300 },
        lngLat: { lng: longitude, lat: latitude }
      });
    }

    project(coordinates?: readonly [number, number]) {
      if (coordinates !== undefined) {
        const projectedPoint = maplibreState.projectedCoordinates.get(
          `${coordinates[0]},${coordinates[1]}`
        );
        if (projectedPoint !== undefined) {
          return projectedPoint;
        }
      }
      return { x: 300, y: 300 };
    }

    queryRenderedFeatures() {
      return maplibreState.queryFeatures;
    }

    getStyle() {
      return { layers: [] };
    }

    hasImage(): boolean {
      return true;
    }

    addImage(): void {}

    addSource(id: string, source: { data: unknown }): void {
      this.sources.set(id, {
        type: "geojson",
        setData: (data: unknown) => {
          maplibreState.sourceData.set(id, data);
        }
      });
      maplibreState.sourceData.set(id, source.data);
    }

    getSource(id: string) {
      return this.sources.get(id);
    }

    addLayer(layer: { id: string }): void {
      this.layers.push(layer.id);
      maplibreState.layerSpecs.set(layer.id, layer);
    }

    setProjection(): void {}

    getCanvas() {
      return { style: { cursor: "" }, clientHeight: 540 };
    }

    getZoom(): number {
      return 12;
    }

    flyTo(): void {}

    fitBounds(): void {}

    zoomTo(): void {}

    remove(): void {}
  }

  class MockPopup {
    content: HTMLElement | undefined;
    readonly options: {
      anchor?: string;
      closeButton?: boolean;
      maxWidth?: string;
    };
    removed = false;

    constructor(
      options: {
        anchor?: string;
        closeButton?: boolean;
        maxWidth?: string;
      } = {}
    ) {
      this.options = options;
      maplibreState.popups.push(this);
    }

    setLngLat(): this {
      return this;
    }

    setDOMContent(content: HTMLElement): this {
      this.content = content;
      return this;
    }

    addTo(): this {
      return this;
    }

    remove(): void {
      this.removed = true;
    }
  }

  return {
    Map: MockMap,
    Popup: MockPopup,
    setWorkerUrl(url: string) {
      maplibreState.calls.push("worker-url");
      maplibreState.workerUrls.push(url);
    }
  };
});

afterEach(() => {
  cleanup();
  maplibreState.calls.length = 0;
  maplibreState.maps.length = 0;
  maplibreState.queryFeatures.length = 0;
  maplibreState.projectedCoordinates.clear();
  maplibreState.sourceData.clear();
  maplibreState.layerSpecs.clear();
  maplibreState.workerUrls.length = 0;
  maplibreState.popups.length = 0;
});

const stop: EligibleStop = {
  featureId: "US-WA-KCM:23",
  sourceFeedId: "US-WA-KCM",
  sourceFeedName: "King County Metro",
  stopId: "23",
  stopName: "Pine Street",
  stopNameExpanded: "Pine Street",
  latitude: 48.014,
  longitude: -122.2,
  locationKind: "platform",
  parentStation: undefined,
  rawFields: {},
  identityTag: { key: "gtfs:stop_id:US-WA-KCM", value: "23" }
};

function candidateFor(node: OsmNode, distanceMeters = 4): CandidateMatch {
  return {
    node,
    distanceMeters,
    evidence: [],
    exactIdentity: false,
    expandedNameEqual: false
  };
}

function renderedCandidateMap(
  node: OsmNode,
  onFeatureClick: (featureId: string) => void
) {
  const candidate = candidateFor(node);
  const matches = new Map<string, InitialMatch>([
    [stop.featureId, { kind: "review", candidates: [candidate] }]
  ]);
  return render(
    <MapView
      nodes={[node]}
      stops={[stop]}
      matches={matches}
      reviews={new Map<string, FeatureReview>()}
      validStopIds={new Map([["US-WA-KCM", new Set(["23"])]])}
      mappedTagsByFeature={
        new Map([[stop.featureId, { name: stop.stopNameExpanded, ref: "23" }]])
      }
      onFeatureClick={onFeatureClick}
    />
  );
}

describe("MapLegend", () => {
  it("starts open and toggles the legend items with accessible state", () => {
    render(<MapLegend />);

    const toggle = screen.getByRole("button", { name: "Collapse map legend" });
    const items = screen.getByRole("list");

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "map-legend-items");
    expect(items).not.toHaveAttribute("hidden");
    expect(items).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Focused stop / closest candidate")).toBeVisible();
    expect(screen.getByText("Alternative candidates (2+)")).toBeVisible();
    expect(screen.getByText("All connections")).toBeVisible();
    expect(screen.getByText("Focused stop-to-candidate link")).toBeVisible();
    expect(screen.getByText("Unmatched stop")).toBeVisible();
    expect(screen.getByText("OSM candidate")).toBeVisible();
    expect(screen.getByText("Reviewed")).toBeVisible();

    fireEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "Expand map legend" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(items).toHaveAttribute("hidden");
    expect(items).not.toHaveAttribute("tabindex");

    fireEvent.click(screen.getByRole("button", { name: "Expand map legend" }));

    expect(
      screen.getByRole("button", { name: "Collapse map legend" })
    ).toHaveAttribute("aria-expanded", "true");
    expect(items).not.toHaveAttribute("hidden");
    expect(items).toHaveAttribute("tabindex", "0");
  });
});

describe("MapView feature interactions", () => {
  it("sets the bundled worker URL before creating the map", async () => {
    render(<MapView nodes={[]} />);

    await waitFor(() => expect(maplibreState.maps).toHaveLength(1));

    expect(maplibreState.workerUrls).toHaveLength(1);
    expect(maplibreState.workerUrls[0]).not.toBe("");
    expect(maplibreState.calls.slice(0, 2)).toEqual(["worker-url", "map"]);
    await waitFor(() =>
      expect(maplibreState.maps[0]?.layers).toEqual(
        expect.arrayContaining([
          "map-processed-casing",
          "map-processed",
          "map-focus-candidates-primary",
          "map-focus-candidates-alternative",
          "map-focus-markers"
        ])
      )
    );
    const layers = maplibreState.maps[0]?.layers ?? [];
    expect(layers.indexOf("map-processed-casing")).toBeLessThan(
      layers.indexOf("map-processed")
    );
  });

  it("uses one highlight for the nearest candidate and another for alternatives", () => {
    const nearest = {
      id: 51,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: {}
    };
    const second = {
      id: 52,
      version: 1,
      latitude: 48.016,
      longitude: -122.202,
      tags: {}
    };
    const third = {
      id: 53,
      version: 1,
      latitude: 48.017,
      longitude: -122.203,
      tags: {}
    };
    const matches = new Map<string, InitialMatch>([
      [
        stop.featureId,
        {
          kind: "review",
          candidates: [
            candidateFor(third, 8),
            candidateFor(nearest, 2),
            candidateFor(second, 5)
          ]
        }
      ]
    ]);

    const highlights = getFocusedCandidateNodeHighlights(
      stop.featureId,
      matches,
      new Map<string, FeatureReview>()
    );

    expect(highlights.size).toBe(3);
    expect(highlights.get(elementKey(nearest))).toBe("primary");
    expect(highlights.get(elementKey(second))).toBe("alternative");
    expect(highlights.get(elementKey(third))).toBe("alternative");
  });

  it("highlights a manually selected OSM element over the automatic match", () => {
    const automaticMatch: OsmNode = {
      id: 56,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: {}
    };
    const manuallySelected: OsmNode = {
      id: 57,
      version: 1,
      latitude: 48.016,
      longitude: -122.202,
      tags: {}
    };
    const matches = new Map<string, InitialMatch>([
      [
        stop.featureId,
        {
          kind: "auto-matched",
          candidate: {
            ...candidateFor(automaticMatch, 2),
            exactIdentity: true
          }
        }
      ]
    ]);
    const review: FeatureReview = {
      featureId: stop.featureId,
      state: "match-selected",
      selectedNodeId: manuallySelected.id,
      selectedElement: { type: "node", id: manuallySelected.id },
      createCoordinates: undefined,
      proposals: []
    };

    const highlights = getFocusedCandidateNodeHighlights(
      stop.featureId,
      matches,
      new Map([[stop.featureId, review]])
    );

    expect(highlights.get(elementKey(automaticMatch))).toBe("alternative");
    expect(highlights.get(elementKey(manuallySelected))).toBe("primary");
  });

  it("connects the focused GTFS stop to its primary OSM candidate", async () => {
    const farther: OsmNode = {
      id: 54,
      version: 1,
      latitude: 48.016,
      longitude: -122.202,
      tags: {}
    };
    const nearest: OsmNode = {
      id: 55,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: {}
    };
    const matches = new Map<string, InitialMatch>([
      [
        stop.featureId,
        {
          kind: "review",
          candidates: [candidateFor(farther, 8), candidateFor(nearest, 2)]
        }
      ]
    ]);
    const stops = [stop];
    const nodes = [farther, nearest];
    const { rerender } = render(
      <MapView
        nodes={nodes}
        stops={stops}
        matches={matches}
        focusedFeatureId={stop.featureId}
      />
    );

    await waitFor(() =>
      expect(maplibreState.maps[0]?.layers).toEqual(
        expect.arrayContaining([
          "map-match-connection-casing",
          "map-match-connection",
          "osm-candidates"
        ])
      )
    );

    const map = maplibreState.maps[0];
    if (map === undefined) {
      throw new Error("MapLibre map was not created");
    }
    expect(map.layers.indexOf("map-match-connection")).toBeLessThan(
      map.layers.indexOf("osm-candidates")
    );
    expect(maplibreState.sourceData.get("map-match-connections")).toMatchObject(
      {
        type: "FeatureCollection",
        features: [
          {
            geometry: {
              type: "LineString",
              coordinates: [
                [stop.longitude, stop.latitude],
                [nearest.longitude, nearest.latitude]
              ]
            }
          }
        ]
      }
    );

    rerender(<MapView nodes={nodes} stops={stops} matches={matches} />);
    await waitFor(() =>
      expect(
        maplibreState.sourceData.get("map-match-connections")
      ).toMatchObject({
        type: "FeatureCollection",
        features: []
      })
    );
  });

  it("shows every primary connection at every zoom, including review candidates", async () => {
    const firstTarget: OsmNode = {
      id: 60,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: {}
    };
    const secondInitialTarget: OsmNode = {
      id: 61,
      version: 1,
      latitude: 48.016,
      longitude: -122.202,
      tags: {}
    };
    const secondSelectedTarget: OsmNode = {
      id: 62,
      version: 1,
      latitude: 48.017,
      longitude: -122.203,
      tags: {}
    };
    const secondStop: EligibleStop = {
      ...stop,
      featureId: "US-WA-KCM:24",
      stopId: "24",
      stopName: "Second Stop",
      stopNameExpanded: "Second Stop",
      latitude: 48.018,
      longitude: -122.204
    };
    const thirdStop: EligibleStop = {
      ...stop,
      featureId: "US-WA-KCM:25",
      stopId: "25",
      stopName: "Third Stop",
      stopNameExpanded: "Third Stop",
      latitude: 48.019,
      longitude: -122.205
    };
    const fartherReviewCandidate: OsmNode = {
      id: 63,
      version: 1,
      latitude: 48.021,
      longitude: -122.207,
      tags: {}
    };
    const nearestReviewCandidate: OsmNode = {
      id: 64,
      version: 1,
      latitude: 48.02,
      longitude: -122.206,
      tags: {}
    };
    const matches = new Map<string, InitialMatch>([
      [
        stop.featureId,
        {
          kind: "auto-matched",
          candidate: candidateFor(firstTarget, 2)
        }
      ],
      [
        secondStop.featureId,
        {
          kind: "auto-matched",
          candidate: candidateFor(secondInitialTarget, 3)
        }
      ],
      [
        thirdStop.featureId,
        {
          kind: "review",
          candidates: [
            candidateFor(fartherReviewCandidate, 8),
            candidateFor(nearestReviewCandidate, 2)
          ]
        }
      ]
    ]);
    const reviews = new Map<string, FeatureReview>([
      [
        stop.featureId,
        {
          featureId: stop.featureId,
          state: "auto-matched",
          selectedNodeId: firstTarget.id,
          selectedElement: { type: "node", id: firstTarget.id },
          createCoordinates: undefined,
          proposals: []
        }
      ],
      [
        secondStop.featureId,
        {
          featureId: secondStop.featureId,
          state: "match-selected",
          selectedNodeId: secondSelectedTarget.id,
          selectedElement: { type: "node", id: secondSelectedTarget.id },
          createCoordinates: undefined,
          proposals: []
        }
      ],
      [
        thirdStop.featureId,
        {
          featureId: thirdStop.featureId,
          state: "unreviewed",
          selectedNodeId: undefined,
          selectedElement: undefined,
          createCoordinates: undefined,
          proposals: []
        }
      ]
    ]);
    render(
      <MapView
        nodes={[
          firstTarget,
          secondInitialTarget,
          secondSelectedTarget,
          fartherReviewCandidate,
          nearestReviewCandidate
        ]}
        stops={[stop, secondStop, thirdStop]}
        matches={matches}
        reviews={reviews}
      />
    );

    await waitFor(() =>
      expect(maplibreState.maps[0]?.layers).toContain("map-all-connections")
    );

    expect(maplibreState.layerSpecs.get("map-all-connections")).toMatchObject({
      minzoom: 0,
      source: "map-all-connections"
    });
    expect(
      maplibreState.layerSpecs.get("map-all-connections-casing")
    ).toMatchObject({ minzoom: 0 });
    expect(maplibreState.sourceData.get("map-all-connections")).toMatchObject({
      type: "FeatureCollection",
      features: [
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [stop.longitude, stop.latitude],
              [firstTarget.longitude, firstTarget.latitude]
            ]
          },
          properties: { featureId: stop.featureId }
        },
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [secondStop.longitude, secondStop.latitude],
              [secondSelectedTarget.longitude, secondSelectedTarget.latitude]
            ]
          },
          properties: { featureId: secondStop.featureId }
        },
        {
          geometry: {
            type: "LineString",
            coordinates: [
              [thirdStop.longitude, thirdStop.latitude],
              [
                nearestReviewCandidate.longitude,
                nearestReviewCandidate.latitude
              ]
            ]
          },
          properties: { featureId: thirdStop.featureId }
        }
      ]
    });
  });

  it("opens tag popups and focuses the queue for stop and OSM candidate icons", async () => {
    const node: OsmNode = {
      id: 50,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: { name: "OSM stop", shelter: "yes" }
    };
    const onFeatureClick = vi.fn();
    renderedCandidateMap(node, onFeatureClick);

    await waitFor(() =>
      expect(maplibreState.maps[0]?.layers).toContain("osm-candidates")
    );
    const map = maplibreState.maps[0];
    if (map === undefined) {
      throw new Error("MapLibre map was not created");
    }

    act(() => map.emitClick("map-marker-matched", stop.featureId));
    expect(onFeatureClick).toHaveBeenLastCalledWith(stop.featureId);
    expect(maplibreState.popups.at(-1)?.content).toHaveTextContent(
      "Profile-mapped tags"
    );
    expect(
      maplibreState.popups
        .at(-1)
        ?.content?.querySelector(".map-feature-popup-header")
    ).toHaveTextContent("GTFS Data");
    expect(
      maplibreState.popups.at(-1)?.content?.querySelector("h3")
    ).toHaveTextContent("Pine Street");
    expect(maplibreState.popups.at(-1)?.options.anchor).toBe("right");
    expect(maplibreState.popups.at(-1)?.content).toHaveTextContent(
      "Pine Street"
    );

    act(() => map.emitClick("osm-candidates", "node:50"));
    expect(onFeatureClick).toHaveBeenLastCalledWith(stop.featureId);
    expect(
      maplibreState.popups
        .at(-1)
        ?.content?.querySelector(".map-feature-popup-header")
    ).toHaveTextContent("OSM Data");
    expect(maplibreState.popups.at(-1)?.content).toHaveTextContent("OSM stop");
    expect(maplibreState.popups.at(-1)?.content).toHaveTextContent("shelter");
    expect(maplibreState.popups.at(-1)?.options.anchor).toBe("right");
    expect(maplibreState.popups.at(-1)?.content?.style.maxHeight).toBe("352px");
    expect(maplibreState.popups.at(-1)?.options.maxWidth).toBe(
      "min(24rem, calc(100% - 1rem))"
    );
    expect(maplibreState.popups[0]?.removed).toBe(true);
  });

  it("previews and applies a link change only after an OSM element is clicked", async () => {
    const original: OsmNode = {
      id: 58,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: { name: "Original stop" }
    };
    const target: OsmNode = {
      id: 59,
      version: 1,
      latitude: 48.016,
      longitude: -122.202,
      tags: { name: "Replacement stop" }
    };
    const matches = new Map<string, InitialMatch>([
      [
        stop.featureId,
        {
          kind: "auto-matched",
          candidate: {
            ...candidateFor(original, 2),
            exactIdentity: true
          }
        }
      ]
    ]);
    let reviews: ReadonlyMap<string, FeatureReview> = new Map([
      [
        stop.featureId,
        {
          featureId: stop.featureId,
          state: "auto-matched",
          selectedNodeId: original.id,
          selectedElement: { type: "node", id: original.id },
          createCoordinates: undefined,
          proposals: []
        }
      ]
    ]);
    const onAction = vi.fn((featureId: string, action: ReviewAction) => {
      const review = reviews.get(featureId);
      if (review !== undefined) {
        reviews = new Map(reviews).set(
          featureId,
          applyReviewAction(review, action)
        );
      }
    });
    const nodes = [original, target];
    const { rerender } = render(
      <MapView
        nodes={nodes}
        stops={[stop]}
        matches={matches}
        reviews={reviews}
        focusedFeatureId={stop.featureId}
        onAction={onAction}
      />
    );

    await waitFor(() =>
      expect(maplibreState.maps[0]?.layers).toContain("osm-candidates")
    );
    const map = maplibreState.maps[0];
    if (map === undefined) {
      throw new Error("MapLibre map was not created");
    }
    act(() => map.emitClick("map-marker-matched", stop.featureId));
    const popup = maplibreState.popups.at(-1)?.content;
    if (popup === undefined) {
      throw new Error("GTFS popup was not created");
    }
    const changeLinkButton = popup.querySelector<HTMLButtonElement>(
      ".map-feature-popup-change-link"
    );
    if (changeLinkButton === null) {
      throw new Error("Change Link button was not created");
    }

    act(() => fireEvent.click(changeLinkButton));
    expect(onAction).not.toHaveBeenCalled();
    expect(changeLinkButton).toHaveTextContent("Cancel Link");
    expect(
      popup.querySelector(".map-feature-popup-link-status")
    ).toHaveTextContent("Click an OSM Data element");
    act(() => map.emitMouseMove(-122.195, 48.02));

    await waitFor(() =>
      expect(maplibreState.sourceData.get("map-link-preview")).toMatchObject({
        type: "FeatureCollection",
        features: [
          {
            geometry: {
              type: "LineString",
              coordinates: [
                [stop.longitude, stop.latitude],
                [-122.195, 48.02]
              ]
            }
          }
        ]
      })
    );
    maplibreState.queryFeatures.push(
      {
        geometry: {
          type: "Point",
          coordinates: [original.longitude, original.latitude]
        },
        properties: { id: elementKey(original) }
      },
      {
        geometry: {
          type: "Point",
          coordinates: [target.longitude, target.latitude]
        },
        properties: { id: elementKey(target) }
      }
    );
    maplibreState.projectedCoordinates.set(
      `${original.longitude},${original.latitude}`,
      { x: 218, y: 300 }
    );
    maplibreState.projectedCoordinates.set(
      `${target.longitude},${target.latitude}`,
      { x: 205, y: 300 }
    );
    act(() => map.emitMouseMove(-122.195, 48.02));
    await waitFor(() =>
      expect(maplibreState.sourceData.get("map-link-preview")).toMatchObject({
        features: [
          {
            geometry: {
              type: "LineString",
              coordinates: [
                [stop.longitude, stop.latitude],
                [target.longitude, target.latitude]
              ]
            }
          }
        ]
      })
    );
    expect(maplibreState.sourceData.get("map-match-connections")).toMatchObject(
      {
        features: [
          {
            geometry: {
              type: "LineString",
              coordinates: [
                [stop.longitude, stop.latitude],
                [original.longitude, original.latitude]
              ]
            },
            properties: { changingLink: true }
          }
        ]
      }
    );
    expect(maplibreState.sourceData.get("map-all-connections")).toMatchObject({
      features: [{ properties: { changingLink: true } }]
    });
    expect(maplibreState.layerSpecs.get("map-match-connection")).toMatchObject({
      paint: {
        "line-opacity": [
          "case",
          ["boolean", ["get", "changingLink"], false],
          0.24,
          0.95
        ]
      }
    });

    act(() => fireEvent.keyDown(document, { key: "Escape" }));
    await waitFor(() => {
      expect(changeLinkButton).toHaveTextContent("Change Link");
      expect(changeLinkButton).toHaveAttribute("aria-pressed", "false");
      expect(maplibreState.sourceData.get("map-link-preview")).toMatchObject({
        features: []
      });
      expect(
        maplibreState.sourceData.get("map-match-connections")
      ).toMatchObject({
        features: [{ properties: { changingLink: false } }]
      });
    });
    expect(onAction).not.toHaveBeenCalled();

    act(() => fireEvent.click(changeLinkButton));
    act(() => map.emitMouseMove(-122.195, 48.02));
    act(() => map.emitClick("osm-candidates", elementKey(target)));
    expect(onAction).toHaveBeenCalledWith(stop.featureId, {
      type: "select-element",
      element: { type: "node", id: target.id }
    });
    expect(maplibreState.popups.at(-1)?.content).toHaveTextContent("OSM Data");
    expect(maplibreState.sourceData.get("map-link-preview")).toMatchObject({
      features: []
    });

    rerender(
      <MapView
        nodes={nodes}
        stops={[stop]}
        matches={matches}
        reviews={reviews}
        focusedFeatureId={stop.featureId}
        onAction={onAction}
      />
    );
    await waitFor(() =>
      expect(
        maplibreState.sourceData.get("map-match-connections")
      ).toMatchObject({
        features: [
          {
            geometry: {
              type: "LineString",
              coordinates: [
                [stop.longitude, stop.latitude],
                [target.longitude, target.latitude]
              ]
            },
            properties: { changingLink: false }
          }
        ]
      })
    );
  });

  it("opens removed-element popups and focuses the removed review item", async () => {
    const node: OsmNode = {
      id: 90,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: { "gtfs:stop_id:US-WA-KCM": "old", name: "Old stop" }
    };
    const onFeatureClick = vi.fn();
    render(
      <MapView
        nodes={[node]}
        validStopIds={new Map([["US-WA-KCM", new Set(["23"])]])}
        onFeatureClick={onFeatureClick}
      />
    );

    await waitFor(() =>
      expect(maplibreState.maps[0]?.layers).toContain("map-marker-removed")
    );
    const map = maplibreState.maps[0];
    if (map === undefined) {
      throw new Error("MapLibre map was not created");
    }

    act(() => map.emitClick("map-marker-removed", "removed-90"));

    expect(onFeatureClick).toHaveBeenCalledWith("removed-90");
    expect(maplibreState.popups.at(-1)?.content).toHaveTextContent("Old stop");
    expect(maplibreState.popups.at(-1)?.content).toHaveTextContent(
      "gtfs:stop_id:US-WA-KCM"
    );
    expect(
      maplibreState.popups
        .at(-1)
        ?.content?.querySelector(".map-feature-popup-header")
    ).toHaveTextContent("OSM Data");
    expect(maplibreState.popups.at(-1)?.options.anchor).toBeUndefined();
  });
});

describe("map feature popup helpers", () => {
  it("places a popup away from a related map feature", () => {
    const clickedPoint = { x: 100, y: 100 };

    expect(
      getPopupAnchorAwayFromRelatedFeature(clickedPoint, { x: 180, y: 110 })
    ).toBe("right");
    expect(
      getPopupAnchorAwayFromRelatedFeature(clickedPoint, { x: 20, y: 110 })
    ).toBe("left");
    expect(
      getPopupAnchorAwayFromRelatedFeature(clickedPoint, { x: 110, y: 180 })
    ).toBe("bottom");
    expect(
      getPopupAnchorAwayFromRelatedFeature(clickedPoint, { x: 110, y: 20 })
    ).toBe("top");
    expect(
      getPopupAnchorAwayFromRelatedFeature(clickedPoint, clickedPoint)
    ).toBeUndefined();
    expect(
      getPopupAnchorAwayFromRelatedFeature(clickedPoint, undefined)
    ).toBeUndefined();
  });

  it("escapes tag text and renders all tags accessibly", () => {
    const content = createMapPopupContent(
      "OSM node 50",
      { name: "<script>alert(1)</script>", shelter: "yes" },
      "OSM tags",
      "OSM Data"
    );

    expect(
      content.firstElementChild?.classList.contains("map-feature-popup-header")
    ).toBe(true);
    expect(
      content.querySelector(".map-feature-popup-header")
    ).toHaveTextContent("OSM Data");
    expect(content.querySelector("h3")).toHaveTextContent("OSM node 50");
    expect(
      content.querySelectorAll(".map-feature-popup-body tbody tr")
    ).toHaveLength(2);
    expect(content).toHaveTextContent("<script>alert(1)</script>");
    expect(content.querySelector("script")).toBeNull();
  });

  it("prioritizes ref and GTFS stop-code tags in popup content", () => {
    const content = createMapPopupContent(
      "OSM node 50",
      {
        bus: "yes",
        "gtfs:stop_code:US-WA-PT": "2754",
        name: "Pierce Transit stop",
        ref: "2754",
        shelter: "yes"
      },
      "OSM tags",
      "OSM Data"
    );
    const tagKeys = Array.from(
      content.querySelectorAll(".map-feature-popup-body tbody th"),
      (cell) => cell.textContent
    );

    expect(tagKeys.slice(0, 3)).toEqual([
      "ref",
      "gtfs:stop_code:US-WA-PT",
      "name"
    ]);
  });

  it("selects the focused review item related to a clicked OSM element", () => {
    const otherStop = { ...stop, featureId: "US-WA-KCM:24", stopId: "24" };
    const node: OsmNode = {
      id: 50,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: {}
    };
    const candidate = candidateFor(node);
    const matches = new Map<string, InitialMatch>([
      [stop.featureId, { kind: "review", candidates: [candidate] }],
      [otherStop.featureId, { kind: "review", candidates: [candidate] }]
    ]);

    expect(
      getRelatedFeatureIdForOsmElement(
        node,
        [stop, otherStop],
        matches,
        new Map(),
        otherStop.featureId
      )
    ).toBe(otherStop.featureId);
    expect(
      getRelatedFeatureIdForOsmElement(
        node,
        [stop, otherStop],
        matches,
        new Map()
      )
    ).toBe(stop.featureId);
    expect(
      getRelatedFeatureIdForOsmElement(
        node,
        [stop, otherStop],
        new Map(),
        new Map()
      )
    ).toBeUndefined();
  });

  it("recognizes an OSM element selected as a replacement link", () => {
    const target: OsmNode = {
      id: 58,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: {}
    };
    const review: FeatureReview = {
      featureId: stop.featureId,
      state: "match-selected",
      selectedNodeId: target.id,
      selectedElement: { type: "node", id: target.id },
      createCoordinates: undefined,
      proposals: []
    };

    expect(
      getRelatedFeatureIdForOsmElement(
        target,
        [stop],
        new Map(),
        new Map([[stop.featureId, review]])
      )
    ).toBe(stop.featureId);
  });
});
