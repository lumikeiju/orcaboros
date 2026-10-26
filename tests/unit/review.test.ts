import { describe, expect, it } from "vitest";
import { createEligibleStop } from "../../src/domain/gtfs";
import { OsmNode } from "../../src/domain/osm";
import {
  applyReviewAction,
  buildTagProposals,
  computeConflationProgress,
  computePostChangeTags,
  firstUndecidedFeatureId,
  legacyIdentityKeys,
  refreshTagProposals,
  staleIdentityKeys,
  validateReviewCompletion
} from "../../src/domain/review";

function fixtureStop() {
  const result = createEligibleStop("US-WA-KCM", "King County Metro", {
    rowNumber: 2,
    fields: {
      stop_id: "1",
      stop_name: "Pine St",
      stop_lat: "47",
      stop_lon: "-122",
      location_type: "0"
    }
  });
  if (!("stop" in result)) {
    throw new Error("invalid fixture");
  }
  return result.stop;
}

const node: OsmNode = {
  id: 1,
  version: 1,
  latitude: 47,
  longitude: -122,
  tags: { name: "Existing", "gtfs:stop_id:US-WA-KCM": "old" }
};

describe("review state and tag decisions", () => {
  it("defaults missing tags to accept and differing values to keep", () => {
    const proposals = buildTagProposals(node, {
      name: "New",
      highway: "bus_stop"
    });
    expect(
      proposals.find((proposal) => proposal.key === "highway")?.resolution
    ).toBe("accept-proposed");
    expect(
      proposals.find((proposal) => proposal.key === "name")?.resolution
    ).toBe("keep-current");
  });

  it("defaults configured OSM key removals to remove while allowing review override", () => {
    const taggedNode: OsmNode = {
      ...node,
      tags: { ...node.tags, obsolete: "legacy" }
    };
    const proposals = buildTagProposals(taggedNode, {}, [], ["obsolete"]);
    const removal = proposals.find((proposal) => proposal.key === "obsolete");
    expect(removal?.defaultResolution).toBe("remove");
    expect(removal?.resolution).toBe("remove");
    expect(
      computePostChangeTags(taggedNode.tags, proposals)
    ).not.toHaveProperty("obsolete");

    const kept = proposals.map((proposal) =>
      proposal.key === "obsolete"
        ? { ...proposal, resolution: "keep-current" as const }
        : proposal
    );
    expect(computePostChangeTags(taggedNode.tags, kept).obsolete).toBe(
      "legacy"
    );
  });

  it("accepts expanded names that are equivalent to the current name", () => {
    const proposals = buildTagProposals(
      {
        ...node,
        tags: {
          name: "Merrill Creek Pkwy & Glenwood Ave - Westbound"
        }
      },
      { name: "Merrill Creek Parkway & Glenwood Avenue - Westbound" }
    );
    const nameProposal = proposals.find((proposal) => proposal.key === "name");
    expect(nameProposal?.resolution).toBe("accept-proposed");
  });

  it("exports the source identity and cleaned name during legacy migration", () => {
    const stop = fixtureStop();
    const matchingNode: OsmNode = {
      ...node,
      tags: {
        "gtfs:stop_id": stop.stopId,
        name: "Pine St"
      }
    };
    const tags = computePostChangeTags(
      matchingNode.tags,
      buildTagProposals(
        matchingNode,
        {
          [stop.identityTag.key]: stop.stopId,
          name: stop.stopNameExpanded
        },
        [],
        legacyIdentityKeys(matchingNode, stop)
      )
    );

    expect(tags).toEqual({
      [stop.identityTag.key]: stop.stopId,
      name: "Pine Street"
    });
  });

  it("refreshes legacy default proposals before output", () => {
    const stop = fixtureStop();
    const matchingNode: OsmNode = {
      ...node,
      tags: {
        "gtfs:stop_id": stop.stopId,
        name: "Pine St"
      }
    };
    const previous = [
      {
        key: "name",
        proposedValue: "Pine Street",
        currentValue: "Pine St",
        defaultResolution: "accept-proposed" as const,
        resolution: "keep-current" as const,
        stale: false
      }
    ];
    const refreshed = refreshTagProposals(
      previous,
      matchingNode,
      {
        [stop.identityTag.key]: stop.stopId,
        name: stop.stopNameExpanded
      },
      [],
      legacyIdentityKeys(matchingNode, stop),
      ["name"]
    );

    expect(computePostChangeTags(matchingNode.tags, refreshed)).toEqual({
      [stop.identityTag.key]: stop.stopId,
      name: "Pine Street"
    });
  });

  it("requires explicit removal for stale selected-source identities", () => {
    const keys = staleIdentityKeys(
      node,
      ["US-WA-KCM"],
      new Map([["US-WA-KCM", new Set(["new"])]])
    );
    expect(keys).toEqual(["gtfs:stop_id:US-WA-KCM"]);
    const proposals = buildTagProposals(node, {}, keys);
    const updated = proposals.map((proposal) =>
      proposal.key === "gtfs:stop_id:US-WA-KCM"
        ? { ...proposal, resolution: "remove" as const }
        : proposal
    );
    expect(computePostChangeTags(node.tags, updated)).not.toHaveProperty(
      "gtfs:stop_id:US-WA-KCM"
    );
  });

  it("removes a matching legacy generic identity tag", () => {
    const matchingNode: OsmNode = {
      ...node,
      tags: {
        "gtfs:stop_id": "1",
        "gtfs:stop_id:US-WA-KCM": "1"
      }
    };
    const removeKeys = legacyIdentityKeys(matchingNode, fixtureStop());
    const proposals = buildTagProposals(
      matchingNode,
      { "gtfs:stop_id:US-WA-KCM": "1" },
      [],
      removeKeys
    );
    const legacyProposal = proposals.find(
      (proposal) => proposal.key === "gtfs:stop_id"
    );
    expect(legacyProposal?.defaultResolution).toBe("remove");
    expect(legacyProposal?.resolution).toBe("remove");
    expect(
      computePostChangeTags(matchingNode.tags, proposals)
    ).not.toHaveProperty("gtfs:stop_id");
  });

  it("keeps a generic identity tag when the feed-specific value differs", () => {
    const mismatchedNode: OsmNode = {
      ...node,
      tags: {
        "gtfs:stop_id": "1",
        "gtfs:stop_id:US-WA-KCM": "2"
      }
    };
    expect(legacyIdentityKeys(mismatchedNode, fixtureStop())).toEqual([]);
  });

  it("removes a generic identity tag when the feed-specific tag is absent", () => {
    const genericOnlyNode: OsmNode = {
      ...node,
      tags: { "gtfs:stop_id": "1" }
    };
    expect(legacyIdentityKeys(genericOnlyNode, fixtureStop())).toEqual([
      "gtfs:stop_id"
    ]);
  });

  it("makes skip and create explicit actions", () => {
    const review = {
      featureId: fixtureStop().featureId,
      state: "unreviewed" as const,
      selectedNodeId: undefined,
      createCoordinates: undefined,
      proposals: []
    };
    expect(applyReviewAction(review, { type: "skip" }).state).toBe("skipped");
    expect(
      applyReviewAction(review, {
        type: "select-create",
        latitude: 47,
        longitude: -122
      }).state
    ).toBe("create-selected");
  });

  it("blocks export for unresolved reviews without requiring identity tags", () => {
    const stopFixture = fixtureStop();
    const issues = validateReviewCompletion([
      {
        featureId: stopFixture.featureId,
        state: "unreviewed",
        selectedNodeId: undefined
      }
    ]);
    expect(issues).toContain(`${stopFixture.featureId} is still unreviewed`);
    expect(
      validateReviewCompletion([
        {
          featureId: stopFixture.featureId,
          state: "match-selected",
          selectedNodeId: 1
        }
      ])
    ).toEqual([]);
  });
});

describe("computeConflationProgress", () => {
  const validStopIds = new Map([["US-WA-KCM", new Set(["1", "2"])]]);

  function review(
    featureId: string,
    state:
      | "unreviewed"
      | "auto-matched"
      | "match-selected"
      | "create-selected"
      | "skipped"
  ) {
    return [
      featureId,
      {
        featureId,
        state,
        selectedNodeId: undefined,
        createCoordinates: undefined,
        proposals: []
      }
    ] as const;
  }

  it("lets OSM-only elements be reviewed unchanged without proposing a deletion", () => {
    const nodes: OsmNode[] = [
      {
        id: 99,
        version: 1,
        latitude: 47,
        longitude: -122,
        tags: { "gtfs:stop_id:US-WA-KCM": "stale" }
      }
    ];
    const reviews = new Map([review("removed-99", "skipped")]);
    expect(
      computeConflationProgress({ stops: [], nodes, reviews, validStopIds })
    ).toEqual({ resolved: 1, total: 1 });
    expect(
      firstUndecidedFeatureId({ stops: [], nodes, reviews, validStopIds })
    ).toBeUndefined();
  });

  it("counts resolved decisions against only-in-osm plus GTFS features", () => {
    const stops = [fixtureStop(), fixtureStop(), fixtureStop()].map(
      (stop, index) => ({
        ...stop,
        featureId: `US-WA-KCM:${index + 1}`
      })
    );
    const nodes: OsmNode[] = [
      {
        id: 10,
        version: 1,
        latitude: 47,
        longitude: -122,
        tags: { "gtfs:stop_id:US-WA-KCM": "stale" }
      },
      {
        id: 11,
        version: 1,
        latitude: 47,
        longitude: -122,
        tags: { "gtfs:stop_id:US-WA-KCM": "1" }
      }
    ];
    const progress = computeConflationProgress({
      stops,
      nodes,
      reviews: new Map([
        review(stops[0].featureId, "auto-matched"),
        review(stops[1].featureId, "skipped")
      ]),
      validStopIds
    });
    expect(progress).toEqual({ resolved: 2, total: 4 });
  });

  it("treats unreviewed features as unresolved and ignores non-identity nodes", () => {
    const stops = [fixtureStop()];
    const nodes: OsmNode[] = [
      {
        id: 12,
        version: 1,
        latitude: 47,
        longitude: -122,
        tags: { name: "Unrelated node" }
      }
    ];
    const progress = computeConflationProgress({
      stops,
      nodes,
      reviews: new Map([review(fixtureStop().featureId, "unreviewed")]),
      validStopIds
    });
    expect(progress).toEqual({ resolved: 0, total: 1 });
  });
});

describe("firstUndecidedFeatureId", () => {
  const validStopIds = new Map([["US-WA-KCM", new Set(["1", "2"])]]);

  function review(
    featureId: string,
    state:
      | "unreviewed"
      | "auto-matched"
      | "match-selected"
      | "create-selected"
      | "skipped"
  ) {
    return [
      featureId,
      {
        featureId,
        state,
        selectedNodeId: undefined,
        createCoordinates: undefined,
        proposals: []
      }
    ] as const;
  }

  function stopWithFeatureId(index: number) {
    return {
      ...fixtureStop(),
      featureId: `US-WA-KCM:${index}`
    };
  }

  it("returns the first stop without a review decision", () => {
    const stops = [stopWithFeatureId(1), stopWithFeatureId(2)];
    expect(
      firstUndecidedFeatureId({
        stops,
        nodes: [],
        reviews: new Map([
          review(stops[0].featureId, "auto-matched"),
          review(stops[1].featureId, "unreviewed")
        ]),
        validStopIds
      })
    ).toBe(stops[1].featureId);
  });

  it("treats a missing review entry as undecided", () => {
    const stops = [stopWithFeatureId(1), stopWithFeatureId(2)];
    expect(
      firstUndecidedFeatureId({
        stops,
        nodes: [],
        reviews: new Map([review(stops[0].featureId, "skipped")]),
        validStopIds
      })
    ).toBe(stops[1].featureId);
  });

  it("falls back to the first OSM-only node after all stops are decided", () => {
    const stops = [stopWithFeatureId(1)];
    const nodes: OsmNode[] = [
      {
        id: 10,
        version: 1,
        latitude: 47,
        longitude: -122,
        tags: { name: "Unrelated node" }
      },
      {
        id: 11,
        version: 1,
        latitude: 47,
        longitude: -122,
        tags: { "gtfs:stop_id:US-WA-KCM": "stale" }
      }
    ];
    expect(
      firstUndecidedFeatureId({
        stops,
        nodes,
        reviews: new Map([review(stops[0].featureId, "skipped")]),
        validStopIds
      })
    ).toBe("removed-11");
  });

  it("returns undefined when every feature has a decision", () => {
    const stops = [stopWithFeatureId(1)];
    const nodes: OsmNode[] = [
      {
        id: 11,
        version: 1,
        latitude: 47,
        longitude: -122,
        tags: { "gtfs:stop_id:US-WA-KCM": "1" }
      }
    ];
    expect(
      firstUndecidedFeatureId({
        stops,
        nodes,
        reviews: new Map([review(stops[0].featureId, "match-selected")]),
        validStopIds
      })
    ).toBeUndefined();
  });
});
