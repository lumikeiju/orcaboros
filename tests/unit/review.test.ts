import { describe, expect, it } from "vitest";
import { createEligibleStop } from "../../src/domain/gtfs";
import { OsmNode } from "../../src/domain/osm";
import {
  applyReviewAction,
  buildTagProposals,
  computePostChangeTags,
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

  it("blocks export for unresolved or identity-incomplete reviews", () => {
    const stopFixture = fixtureStop();
    const issues = validateReviewCompletion(
      [
        {
          featureId: stopFixture.featureId,
          state: "unreviewed",
          requiredIdentityKey: stopFixture.identityTag.key,
          requiredIdentityValue: stopFixture.stopId,
          selectedNodeId: undefined
        }
      ],
      new Map()
    );
    expect(issues).toContain(`${stopFixture.featureId} is still unreviewed`);
    expect(
      validateReviewCompletion(
        [
          {
            featureId: stopFixture.featureId,
            state: "match-selected",
            requiredIdentityKey: stopFixture.identityTag.key,
            requiredIdentityValue: stopFixture.stopId,
            selectedNodeId: 1
          }
        ],
        new Map([[1, { name: "Missing identity" }]])
      )
    ).toContain(`${stopFixture.featureId} has no required identity tag`);
  });
});
