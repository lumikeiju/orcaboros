import { describe, expect, it } from "vitest";
import {
  determineInitialMatch,
  validateSelectedClaims
} from "../../src/domain/matching";
import { createEligibleStop } from "../../src/domain/gtfs";
import { OsmNode } from "../../src/domain/osm";

function stop() {
  const result = createEligibleStop("US-WA-KCM", "King County Metro", {
    rowNumber: 2,
    fields: {
      stop_id: "KCM-1",
      stop_name: "Pine St",
      stop_lat: "47.6100",
      stop_lon: "-122.3350",
      location_type: "0"
    }
  });
  if (!("stop" in result)) {
    throw new Error("fixture stop is invalid");
  }
  return result.stop;
}

const exactNode: OsmNode = {
  id: 10,
  version: 4,
  latitude: 47.61001,
  longitude: -122.33501,
  tags: {
    name: "Pine Street",
    "gtfs:stop_id:US-WA-KCM": "KCM-1"
  }
};

describe("conservative spatial matching", () => {
  it("auto-selects only a unique exact identity within 10 m", () => {
    const result = determineInitialMatch(stop(), [exactNode], 50, 10);
    expect(result.kind).toBe("auto-matched");
  });

  it("does not auto-select name-only evidence", () => {
    const result = determineInitialMatch(
      stop(),
      [{ ...exactNode, id: 11, tags: { name: "Pine Street" } }],
      50,
      10
    );
    expect(result.kind).toBe("review");
  });

  it("allows distinct stops from one source feed to use different nodes", () => {
    const issues = validateSelectedClaims([
      { feature: { sourceFeedId: "US-WA-KCM", stopId: "1" }, nodeId: 1 },
      { feature: { sourceFeedId: "US-WA-KCM", stopId: "2" }, nodeId: 2 }
    ]);
    expect(issues).toEqual([]);
  });

  it("reports the same stop claimed by multiple OSM nodes", () => {
    const issues = validateSelectedClaims([
      { feature: { sourceFeedId: "US-WA-KCM", stopId: "1" }, nodeId: 1 },
      { feature: { sourceFeedId: "US-WA-KCM", stopId: "1" }, nodeId: 2 }
    ]);
    expect(
      issues.some((issue) =>
        issue.includes("US-WA-KCM/1 is claimed by multiple OSM nodes")
      )
    ).toBe(true);
  });
});
