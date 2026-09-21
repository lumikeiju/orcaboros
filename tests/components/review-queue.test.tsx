import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { ReviewQueue } from "../../src/components/ReviewQueue";
import type { EligibleStop } from "../../src/domain/gtfs";
import type { CandidateMatch } from "../../src/domain/matching";
import type { OsmNode } from "../../src/domain/osm";

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

afterEach(() => cleanup());

describe("ReviewQueue", () => {
  it("focuses the map when a review card is activated", () => {
    const onFocusFeature = vi.fn();
    const { container } = render(
      <ReviewQueue
        stops={[stop]}
        matches={new Map()}
        reviews={new Map()}
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
      4
    );
    expect(container.querySelectorAll(".review-diff-row.is-none")).toHaveLength(
      2
    );
    expect(
      container.querySelectorAll(
        ".review-diff-row.is-add .review-diff-cell-add.is-highlighted"
      )
    ).toHaveLength(4);
    expect(
      container.querySelectorAll(
        ".review-diff-row.is-add .review-diff-cell-remove.is-highlighted"
      )
    ).toHaveLength(0);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Focus State Avenue & 92nd Street NE on the map"
      })
    );
    expect(onFocusFeature).toHaveBeenCalledWith(stop.featureId);
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
