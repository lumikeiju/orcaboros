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
  getRelatedFeatureIdForOsmElement,
  MapLegend,
  MapView
} from "../../src/components/MapView";
import type { EligibleStop } from "../../src/domain/gtfs";
import type { CandidateMatch, InitialMatch } from "../../src/domain/matching";
import type { OsmNode } from "../../src/domain/osm";
import type { FeatureReview } from "../../src/domain/review";

const maplibreState = vi.hoisted(() => ({
  calls: [] as string[],
  maps: [] as Array<{
    layers: string[];
    emitClick: (layerId: string, id: string) => void;
  }>,
  workerUrls: [] as string[],
  popups: [] as Array<{
    content: HTMLElement | undefined;
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
      { type: "geojson"; setData: () => void }
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
        point: { y: 300 },
        lngLat: { lng: -122.2, lat: 48.014 }
      });
    }

    getStyle() {
      return { layers: [] };
    }

    hasImage(): boolean {
      return true;
    }

    addImage(): void {}

    addSource(id: string): void {
      this.sources.set(id, { type: "geojson", setData: () => undefined });
    }

    getSource(id: string) {
      return this.sources.get(id);
    }

    addLayer(layer: { id: string }): void {
      this.layers.push(layer.id);
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
    removed = false;

    constructor() {
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

function candidateFor(node: OsmNode): CandidateMatch {
  return {
    node,
    distanceMeters: 4,
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

    fireEvent.click(toggle);

    expect(
      screen.getByRole("button", { name: "Expand map legend" })
    ).toHaveAttribute("aria-expanded", "false");
    expect(items).toHaveAttribute("hidden");

    fireEvent.click(screen.getByRole("button", { name: "Expand map legend" }));

    expect(
      screen.getByRole("button", { name: "Collapse map legend" })
    ).toHaveAttribute("aria-expanded", "true");
    expect(items).not.toHaveAttribute("hidden");
  });
});

describe("MapView feature interactions", () => {
  it("sets the bundled worker URL before creating the map", async () => {
    render(<MapView nodes={[]} />);

    await waitFor(() => expect(maplibreState.maps).toHaveLength(1));

    expect(maplibreState.workerUrls).toHaveLength(1);
    expect(maplibreState.workerUrls[0]).not.toBe("");
    expect(maplibreState.calls.slice(0, 2)).toEqual(["worker-url", "map"]);
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
    expect(maplibreState.popups.at(-1)?.content).toHaveTextContent(
      "Pine Street"
    );

    act(() => map.emitClick("osm-candidates", "node:50"));
    expect(onFeatureClick).toHaveBeenLastCalledWith(stop.featureId);
    expect(maplibreState.popups.at(-1)?.content).toHaveTextContent("OSM stop");
    expect(maplibreState.popups.at(-1)?.content).toHaveTextContent("shelter");
    expect(maplibreState.popups[0]?.removed).toBe(true);
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
  });
});

describe("map feature popup helpers", () => {
  it("escapes tag text and renders all tags accessibly", () => {
    const content = createMapPopupContent(
      "OSM node 50",
      { name: "<script>alert(1)</script>", shelter: "yes" },
      "OSM tags"
    );

    expect(content.querySelector("h3")).toHaveTextContent("OSM node 50");
    expect(content.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(content).toHaveTextContent("<script>alert(1)</script>");
    expect(content.querySelector("script")).toBeNull();
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
});
