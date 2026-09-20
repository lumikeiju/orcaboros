import { describe, expect, it } from "vitest";
import type { EligibleStop } from "../../src/domain/gtfs";
import type { CandidateMatch } from "../../src/domain/matching";
import type { OsmNode } from "../../src/domain/osm";
import type { FeatureReview } from "../../src/domain/review";
import {
  buildMapMarkers,
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  getStopBounds,
  shouldShowZoomNotice
} from "../../src/components/MapView";

function stop(
  featureId: string,
  latitude: number,
  longitude: number
): EligibleStop {
  return {
    featureId,
    sourceFeedId: "US-WA-KCM",
    sourceFeedName: "King County Metro",
    stopId: featureId,
    stopName: featureId,
    stopNameExpanded: featureId,
    latitude,
    longitude,
    locationKind: "platform",
    parentStation: undefined,
    rawFields: {},
    identityTag: { key: "gtfs:stop_id:US-WA-KCM", value: featureId }
  };
}

function node(
  id: number,
  latitude: number,
  longitude: number,
  tags = {}
): OsmNode {
  return { id, version: 1, latitude, longitude, tags };
}

function candidateMatch(
  candidate: OsmNode,
  distanceMeters: number
): CandidateMatch {
  return {
    node: candidate,
    distanceMeters,
    evidence: [],
    exactIdentity: true,
    expandedNameEqual: false
  };
}

describe("map stop extent", () => {
  it("uses the shared globe view as the default camera", () => {
    expect(DEFAULT_MAP_CENTER).toEqual([-98, 39]);
    expect(DEFAULT_MAP_ZOOM).toBe(1.6);
  });

  it("returns the loaded stop bounds", () => {
    expect(
      getStopBounds([
        stop("north-east", 47.7, -122.1),
        stop("south-west", 47.4, -122.5),
        stop("middle", 47.6, -122.3)
      ])
    ).toEqual([
      [-122.5, 47.4],
      [-122.1, 47.7]
    ]);
  });

  it("returns no bounds when no stops are loaded", () => {
    expect(getStopBounds([])).toBeUndefined();
  });

  it("keeps stops pending until matching has run", () => {
    const pending = buildMapMarkers([stop("pending", 47.61, -122.33)], []);

    expect(pending.markers).toEqual([
      expect.objectContaining({ id: "pending", kind: "pending" })
    ]);
  });

  it("uses distinct marker categories for matched, moved, new, and removed features", () => {
    const exactStop = stop("exact", 47.61, -122.33);
    const movedStop = stop("moved", 47.62, -122.34);
    const newStop = stop("new", 47.63, -122.35);
    const exactNode = node(1, 47.6101, -122.3301);
    const movedNode = node(2, 47.6201, -122.3401);
    const removedNode = node(3, 47.64, -122.36, {
      "gtfs:stop_id:US-WA-KCM": "old"
    });
    const contextNode = node(4, 47.65, -122.37);
    const result = buildMapMarkers(
      [exactStop, movedStop, newStop],
      [exactNode, movedNode, removedNode, contextNode],
      new Map([
        [
          exactStop.featureId,
          { kind: "review", candidates: [candidateMatch(exactNode, 5)] }
        ],
        [
          movedStop.featureId,
          { kind: "review", candidates: [candidateMatch(movedNode, 25)] }
        ]
      ]),
      new Map<string, FeatureReview>([
        [
          movedStop.featureId,
          {
            featureId: movedStop.featureId,
            state: "create-selected",
            selectedNodeId: undefined,
            createCoordinates: {
              latitude: movedStop.latitude,
              longitude: movedStop.longitude
            },
            proposals: []
          }
        ],
        [
          newStop.featureId,
          {
            featureId: newStop.featureId,
            state: "skipped",
            selectedNodeId: undefined,
            createCoordinates: undefined,
            proposals: []
          }
        ]
      ]),
      new Map([
        [
          "US-WA-KCM",
          new Set([exactStop.stopId, movedStop.stopId, newStop.stopId])
        ]
      ]),
      10
    );

    expect(result.markers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: exactStop.featureId, kind: "matched" }),
        expect.objectContaining({
          id: movedStop.featureId,
          kind: "moved",
          processed: true
        }),
        expect.objectContaining({
          id: newStop.featureId,
          kind: "new",
          processed: true
        }),
        expect.objectContaining({ id: "removed-3", kind: "removed" })
      ])
    );
    expect(result.candidateNodes).toEqual([exactNode, movedNode, contextNode]);
  });
});

describe("map zoom notice", () => {
  it("shows below the icon detail zoom and hides at the threshold", () => {
    expect(shouldShowZoomNotice(10.99)).toBe(true);
    expect(shouldShowZoomNotice(11)).toBe(false);
  });
});
