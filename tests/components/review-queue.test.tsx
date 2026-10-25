import { fireEvent, render, screen, within } from "@testing-library/react";
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
  rawFields: { stop_code: "CT-23" },
  identityTag: { key: "gtfs:stop_id:US-WA-CT", value: "23" }
};

function makeStop(index: number): EligibleStop {
  return {
    ...stop,
    featureId: `US-WA-CT:${index}`,
    stopId: String(index),
    stopName: `Stop ${index}`,
    stopNameExpanded: `Stop ${index}`,
    rawFields: { stop_id: String(index), stop_code: `CT-${index}` },
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
  it("focuses the map with an explicit button in semantic list items", () => {
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
      screen.getByRole("heading", { name: "Review Queue (1)", level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Decision", level: 2 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Comparison", level: 2 })
    ).toBeInTheDocument();
    expect(screen.queryByText("Stop comparison")).not.toBeInTheDocument();
    expect(container.querySelectorAll(".review-columns > *")).toHaveLength(3);
    const columns = [...container.querySelectorAll(".review-columns > *")];
    expect(columns[0]).toHaveClass("review-queue-panel");
    expect(columns[1]).toHaveClass("review-decision");
    expect(columns[2]).toHaveClass("review-comparison");
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
    expect(screen.getByText("US-WA-CT • CT-23 • platform")).toBeInTheDocument();

    expect(container.querySelector("li[role='button']")).toBeNull();
    const locateButton = screen.getByRole("button", {
      name: "Focus State Avenue & 92nd Street NE on the map"
    });
    expect(locateButton).toHaveAttribute("title", "Locate on map");
    expect(locateButton.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
    expect(locateButton).not.toHaveTextContent("Locate on map");
    fireEvent.click(locateButton);
    expect(onFocusFeature).toHaveBeenCalledWith(stop.featureId);
    expect(
      container.querySelector(".review-card-heading + .review-card-status-row")
    ).toBeInTheDocument();
    expect(
      container.querySelector(
        ".review-card-heading .category, .review-card-heading .state"
      )
    ).toBeNull();
    expect(locateButton.closest(".review-card-heading")).toBeNull();
    expect(locateButton.closest(".review-card-status-row")).toBeInTheDocument();
    expect(
      container.querySelector(".review-card-states .category")
    ).toBeInTheDocument();
    expect(
      container.querySelector(".review-card-states .state")
    ).toBeInTheDocument();
  });

  it("shows a placeholder when a stop has no stop code", () => {
    const stopWithoutCode = { ...stop, rawFields: {} };
    render(
      <ReviewQueue
        stops={[stopWithoutCode]}
        matches={new Map()}
        reviews={new Map()}
        onAction={vi.fn()}
        onFocusFeature={vi.fn()}
      />
    );

    expect(screen.getByText("US-WA-CT • — • platform")).toBeInTheDocument();
  });

  it("allows all result filters to be cleared and reopens them from the empty state", () => {
    const { container } = render(
      <ReviewQueue
        stops={[stop]}
        matches={new Map()}
        reviews={new Map()}
        focusedFeatureId={stop.featureId}
        onAction={vi.fn()}
        onFocusFeature={vi.fn()}
      />
    );
    const filterDetails = container.querySelector("details.review-filters");

    expect(filterDetails).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Filters"));
    expect(filterDetails).toHaveAttribute("open");
    expect(
      screen.getByRole("group", { name: "Show results" })
    ).toBeInTheDocument();

    for (const category of ["new", "removed", "moved"] as const) {
      const toggle = screen.getByRole("switch", {
        name: `Show ${category} results`
      });
      expect(toggle).toHaveAttribute("aria-checked", "true");
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute("aria-checked", "false");
    }
    expect(
      screen.getByRole("switch", { name: "Show exact results" })
    ).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText("0 results")).toBeInTheDocument();
    expect(container.querySelectorAll(".review-list > li")).toHaveLength(0);

    const checkFilters = screen.getByRole("button", {
      name: "Check filters?"
    });
    fireEvent.click(screen.getByText("Filters"));
    expect(filterDetails).not.toHaveAttribute("open");
    fireEvent.click(checkFilters);
    expect(filterDetails).toHaveAttribute("open");
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

  it("highlights configured OSM key removals in the comparison", () => {
    const candidate = {
      ...makeExactCandidate(22, 3),
      exactIdentity: false,
      node: {
        ...makeExactCandidate(22, 3).node,
        tags: { shelter: "yes" }
      }
    };
    const review: FeatureReview = {
      featureId: stop.featureId,
      state: "auto-matched",
      selectedNodeId: candidate.node.id,
      selectedElement: { type: "node", id: candidate.node.id },
      createCoordinates: undefined,
      proposals: buildTagProposals(candidate.node, {}, [], ["shelter"])
    };
    const { container } = render(
      <ReviewQueue
        stops={[stop]}
        matches={
          new Map([
            [stop.featureId, { kind: "review", candidates: [candidate] }]
          ])
        }
        reviews={new Map([[stop.featureId, review]])}
        onAction={vi.fn()}
        onFocusFeature={vi.fn()}
      />
    );

    expect(diffRow(container, "shelter")).toHaveClass("is-remove");
    expect(
      diffRow(container, "shelter")?.querySelector(".review-diff-cell-remove")
    ).toHaveClass("is-highlighted");
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

  it("does not focus the map when a review decision is clicked", () => {
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

    fireEvent.click(
      within(screen.getByRole("list")).getByRole("button", {
        name: "Skip feature"
      })
    );
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

  it("jumps directly to the first and last result pages", () => {
    const stops = Array.from({ length: 21 }, (_, index) => makeStop(index + 1));
    render(
      <ReviewQueue
        stops={stops}
        matches={new Map()}
        reviews={new Map()}
        onAction={vi.fn()}
        onFocusFeature={vi.fn()}
      />
    );

    const firstPageButton = screen.getByRole("button", { name: "First" });
    const lastPageButton = screen.getByRole("button", { name: "Last" });
    expect(firstPageButton).toBeDisabled();
    expect(lastPageButton).toBeEnabled();

    fireEvent.click(lastPageButton);
    expect(screen.getByText("Page 3 of 3")).toBeInTheDocument();
    expect(screen.getByText("Showing 21-21 of 21 results")).toBeInTheDocument();
    expect(firstPageButton).toBeEnabled();
    expect(lastPageButton).toBeDisabled();

    fireEvent.click(firstPageButton);
    expect(screen.getByText("Page 1 of 3")).toBeInTheDocument();
    expect(screen.getByText("Showing 1-10 of 21 results")).toBeInTheDocument();
    expect(firstPageButton).toBeDisabled();
    expect(lastPageButton).toBeEnabled();
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

    fireEvent.click(screen.getByText("Filters"));
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

    const focusButton = screen.getByRole("button", {
      name: "Focus OSM node 90 on the map"
    });
    expect(focusButton).toHaveClass("is-focused");
    expect(focusButton.closest(".review-card-heading")).toBeNull();
    expect(focusButton.closest(".review-card-status-row")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Node 90" })
    ).toBeInTheDocument();
  });
});
