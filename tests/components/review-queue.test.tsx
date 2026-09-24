import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { ReviewQueue } from "../../src/components/ReviewQueue";
import type { EligibleStop } from "../../src/domain/gtfs";
import type { CandidateMatch } from "../../src/domain/matching";
import type { OsmNode, OsmWay } from "../../src/domain/osm";
import { buildTagProposals, type FeatureReview } from "../../src/domain/review";
import type { GeometryTarget } from "../../src/domain/source-feed";

const stop: EligibleStop = {
  featureId: "US-WA-CT:23",
  sourceFeedId: "US-WA-CT",
  sourceFeedName: "Community Transit",
  stopId: "23",
  stopName: "State Avenue & 92nd Street NE",
  stopNameExpanded: "State Avenue & 92nd Street NE",
  latitude: 48.014,
  longitude: -122.2,
  locationKind: "platform",
  parentStation: undefined,
  rawFields: {},
  identityTag: { key: "gtfs:stop_id:US-WA-CT", value: "23" }
};

function makeStop(index: number): EligibleStop {
  return {
    ...stop,
    featureId: `US-WA-CT:${index}`,
    stopId: String(index),
    stopName: `Stop ${index}`,
    stopNameExpanded: `Stop ${index}`,
    identityTag: { key: "gtfs:stop_id:US-WA-CT", value: String(index) }
  };
}

function makeExactCandidate(
  id: number,
  distanceMeters: number
): CandidateMatch {
  const node: OsmNode = {
    id,
    version: 1,
    latitude: 48.014,
    longitude: -122.2,
    tags: {}
  };
  return {
    node,
    distanceMeters,
    evidence: [],
    exactIdentity: true,
    expandedNameEqual: false
  };
}

function makeReview(
  featureId: string,
  proposedTags: Readonly<Record<string, string>>
): FeatureReview {
  return {
    featureId,
    state: "unreviewed",
    selectedNodeId: undefined,
    createCoordinates: undefined,
    proposals: buildTagProposals(undefined, proposedTags)
  };
}

function tagFieldCount(container: HTMLElement, key: string): number {
  return [
    ...container.querySelectorAll(".review-diff-columns .review-diff-field")
  ].filter((field) => field.textContent === key).length;
}

function diffRow(container: HTMLElement, fieldName: string): Element | null {
  return (
    [...container.querySelectorAll(".review-diff-field")]
      .find((field) => field.textContent === fieldName)
      ?.closest("tr") ?? null
  );
}

function renderCoordinateComparison(
  geometryTarget: GeometryTarget,
  node: OsmNode | OsmWay
): HTMLElement {
  const candidate: CandidateMatch = {
    ...makeExactCandidate(node.id, 5),
    node,
    exactIdentity: false
  };
  const { container } = render(
    <ReviewQueue
      stops={[stop]}
      matches={
        new Map([[stop.featureId, { kind: "review", candidates: [candidate] }]])
      }
      reviews={new Map()}
      geometryTargets={new Map([[stop.sourceFeedId, geometryTarget]])}
      onAction={vi.fn()}
      onFocusFeature={vi.fn()}
    />
  );
  return container;
}

afterEach(() => cleanup());

describe("ReviewQueue", () => {
  it("focuses the map when a review card is activated", () => {
    const onFocusFeature = vi.fn();
    const { container } = render(
      <ReviewQueue
        stops={[stop]}
        matches={new Map()}
        reviews={
          new Map([
            [
              stop.featureId,
              makeReview(stop.featureId, {
                [stop.identityTag.key]: stop.stopId,
                name: stop.stopNameExpanded,
                public_transport: "platform"
              })
            ]
          ])
        }
        onAction={vi.fn()}
        onFocusFeature={onFocusFeature}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Review Queue (1)" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Comparison" })
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".review-columns > *")).toHaveLength(3);
    expect(
      screen.getByRole("columnheader", { name: "GTFS" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("columnheader", { name: "OSM" })
    ).toBeInTheDocument();
    expect(
      container.querySelectorAll(".review-diff-columns tbody tr")
    ).toHaveLength(6);
    expect(container.querySelectorAll(".review-diff-row.is-add")).toHaveLength(
      5
    );
    expect(container.querySelectorAll(".review-diff-row.is-none")).toHaveLength(
      1
    );
    expect(
      container.querySelectorAll(
        ".review-diff-row.is-add .review-diff-cell-add.is-highlighted"
      )
    ).toHaveLength(5);
    expect(
      container.querySelectorAll(
        ".review-diff-row.is-add .review-diff-cell-remove.is-highlighted"
      )
    ).toHaveLength(0);
    expect(tagFieldCount(container, "public_transport")).toBe(2);
    expect(screen.getByText("platform")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Focus State Avenue & 92nd Street NE on the map"
      })
    );
    expect(onFocusFeature).toHaveBeenCalledWith(stop.featureId);
  });

  it("shows every GTFS-mapped tag and OSM candidate tag", () => {
    const candidate = {
      ...makeExactCandidate(21, 3),
      exactIdentity: false,
      node: {
        ...makeExactCandidate(21, 3).node,
        tags: {
          [stop.identityTag.key]: stop.stopId,
          name: "Existing stop name",
          highway: "bus_stop",
          shelter: "yes"
        }
      }
    };
    const proposedTags = {
      [stop.identityTag.key]: stop.stopId,
      name: stop.stopNameExpanded,
      public_transport: "platform",
      ref: "CT-23"
    };
    const { container } = render(
      <ReviewQueue
        stops={[stop]}
        matches={
          new Map([
            [stop.featureId, { kind: "review", candidates: [candidate] }]
          ])
        }
        reviews={
          new Map([[stop.featureId, makeReview(stop.featureId, proposedTags)]])
        }
        onAction={vi.fn()}
        onFocusFeature={vi.fn()}
      />
    );

    const rows = container.querySelectorAll(".review-diff-columns tbody tr");
    expect(rows).toHaveLength(9);
    expect(tagFieldCount(container, stop.identityTag.key)).toBe(2);
    expect(tagFieldCount(container, "public_transport")).toBe(2);
    expect(tagFieldCount(container, "ref")).toBe(2);
    expect(tagFieldCount(container, "highway")).toBe(2);
    expect(tagFieldCount(container, "shelter")).toBe(2);
    expect(screen.getByText("platform")).toBeInTheDocument();
    expect(screen.getByText("CT-23")).toBeInTheDocument();
    expect(screen.getByText("bus_stop")).toBeInTheDocument();
    expect(screen.getByText("yes")).toBeInTheDocument();
    expect(screen.getAllByText("(not proposed)")).toHaveLength(2);
    expect(screen.getAllByText("(missing)")).toHaveLength(2);

    const rowForTag = (key: string): Element | null =>
      [...container.querySelectorAll(".review-diff-field")]
        .find((field) => field.textContent === key)
        ?.closest("tr") ?? null;
    expect(rowForTag("public_transport")).toHaveClass("is-add");
    expect(rowForTag("name")).toHaveClass("is-both");
    expect(rowForTag("shelter")).toHaveClass("is-none");
  });

  it("does not mark coordinates as changes for the OSM geometry target", () => {
    const node: OsmNode = {
      id: 30,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: {}
    };
    const container = renderCoordinateComparison("osm", node);

    expect(diffRow(container, "stop_lat")).toHaveClass("is-none");
    expect(diffRow(container, "stop_lon")).toHaveClass("is-none");
  });

  it("marks changed node coordinates for the GTFS geometry target", () => {
    const node: OsmNode = {
      id: 31,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      tags: {}
    };
    const container = renderCoordinateComparison("gtfs", node);

    expect(diffRow(container, "stop_lat")).toHaveClass("is-both");
    expect(diffRow(container, "stop_lon")).toHaveClass("is-both");
  });

  it("does not mark platform-way coordinates as changes for the GTFS target", () => {
    const way: OsmWay = {
      type: "way",
      id: 32,
      version: 1,
      latitude: 48.015,
      longitude: -122.201,
      nodeRefs: [1, 2, 3],
      tags: {}
    };
    const container = renderCoordinateComparison("gtfs", way);

    expect(diffRow(container, "stop_lat")).toHaveClass("is-none");
    expect(diffRow(container, "stop_lon")).toHaveClass("is-none");
  });

  it("does not focus the map when a nested review action is clicked", () => {
    const onFocusFeature = vi.fn();
    const onAction = vi.fn();
    render(
      <ReviewQueue
        stops={[stop]}
        matches={new Map()}
        reviews={new Map()}
        onAction={onAction}
        onFocusFeature={onFocusFeature}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: "Skip feature" }));
    expect(onFocusFeature).not.toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledWith(stop.featureId, { type: "skip" });
  });

  it("shows decision actions above the comparison and advances after a decision", () => {
    const firstStop = makeStop(1);
    const secondStop = makeStop(2);
    const onAction = vi.fn();
    const onFocusFeature = vi.fn();
    render(
      <ReviewQueue
        stops={[firstStop, secondStop]}
        matches={
          new Map([
            [
              firstStop.featureId,
              {
                kind: "review",
                candidates: [
                  { ...makeExactCandidate(20, 5), exactIdentity: false }
                ]
              }
            ]
          ])
        }
        reviews={new Map()}
        onAction={onAction}
        onFocusFeature={onFocusFeature}
      />
    );

    expect(
      screen.getByRole("heading", { name: "Decision" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Comparison" })
    ).toBeInTheDocument();
    expect(
      document.querySelector(".review-detail .review-decision-actions")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Accept match" }));

    expect(onAction).toHaveBeenCalledWith(firstStop.featureId, {
      type: "select-match",
      nodeId: 20
    });
    expect(onFocusFeature).toHaveBeenCalledWith(secondStop.featureId);
  });

  it("shows discrepancies by default and can reveal exact matches", () => {
    const newStop = makeStop(1);
    const movedStop = makeStop(2);
    const exactStop = makeStop(3);
    const removedNode: OsmNode = {
      id: 90,
      version: 2,
      latitude: 48.014,
      longitude: -122.2,
      tags: { "gtfs:stop_id:US-WA-CT": "old" }
    };
    render(
      <ReviewQueue
        stops={[newStop, movedStop, exactStop]}
        matches={
          new Map([
            [
              movedStop.featureId,
              { kind: "review", candidates: [makeExactCandidate(20, 20)] }
            ],
            [
              exactStop.featureId,
              { kind: "review", candidates: [makeExactCandidate(30, 5)] }
            ]
          ])
        }
        reviews={new Map()}
        nodes={[removedNode]}
        validStopIds={new Map([["US-WA-CT", new Set(["1", "2", "3"])]])}
        exactMatchRadiusMeters={10}
        onAction={vi.fn()}
        onFocusFeature={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: "Focus Stop 1 on the map" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Focus Stop 2 on the map" })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Focus Stop 3 on the map" })
    ).not.toBeInTheDocument();
    expect(screen.getByText("OSM node 90")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch", { name: "Show exact results" }));
    expect(
      screen.getByRole("button", { name: "Focus Stop 3 on the map" })
    ).toBeInTheDocument();
  });

  it("paginates results in groups of ten", () => {
    const stops = Array.from({ length: 11 }, (_, index) => makeStop(index + 1));
    render(
      <ReviewQueue
        stops={stops}
        matches={new Map()}
        reviews={new Map()}
        onAction={vi.fn()}
        onFocusFeature={vi.fn()}
      />
    );

    expect(screen.getByText("Showing 1-10 of 11 results")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Focus Stop 11 on the map" })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Showing 11-11 of 11 results")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Focus Stop 11 on the map" })
    ).toBeInTheDocument();
  });

  it("reveals and focuses a map-selected item on another page", () => {
    const stops = Array.from({ length: 11 }, (_, index) => makeStop(index + 1));
    render(
      <ReviewQueue
        stops={stops}
        matches={new Map()}
        reviews={new Map()}
        focusedFeatureId="US-WA-CT:11"
        onAction={vi.fn()}
        onFocusFeature={vi.fn()}
      />
    );

    expect(screen.getByText("Showing 11-11 of 11 results")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Focus Stop 11 on the map" })
    ).toHaveClass("is-focused");
  });

  it("reveals an exact result when a map marker focuses it", () => {
    const exactStop = makeStop(1);
    render(
      <ReviewQueue
        stops={[exactStop]}
        matches={
          new Map([
            [
              exactStop.featureId,
              { kind: "review", candidates: [makeExactCandidate(40, 5)] }
            ]
          ])
        }
        reviews={new Map()}
        exactMatchRadiusMeters={10}
        focusedFeatureId={exactStop.featureId}
        onAction={vi.fn()}
        onFocusFeature={vi.fn()}
      />
    );

    expect(
      screen.getByRole("switch", { name: "Show exact results" })
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("button", { name: "Focus Stop 1 on the map" })
    ).toHaveClass("is-focused");
  });

  it("focuses a removed node selected from the map", () => {
    const removedNode: OsmNode = {
      id: 90,
      version: 2,
      latitude: 48.014,
      longitude: -122.2,
      tags: { "gtfs:stop_id:US-WA-CT": "old" }
    };
    render(
      <ReviewQueue
        stops={[]}
        matches={new Map()}
        reviews={new Map()}
        nodes={[removedNode]}
        validStopIds={new Map([["US-WA-CT", new Set<string>()]])}
        focusedFeatureId="removed-90"
        onAction={vi.fn()}
        onFocusFeature={vi.fn()}
      />
    );

    expect(
      screen.getByRole("button", { name: "Focus OSM node 90 on the map" })
    ).toHaveClass("is-focused");
    expect(
      screen.getByRole("heading", { name: "Node 90" })
    ).toBeInTheDocument();
  });
});
