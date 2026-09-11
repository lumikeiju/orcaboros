import { describe, expect, it } from "vitest";
import {
  createEligibleStop,
  locationKindForValue
} from "../../src/domain/gtfs";
import {
  evaluateMappingRules,
  validateMappingProfile
} from "../../src/domain/profile";

describe("GTFS stop eligibility", () => {
  const fields = {
    stop_id: "KCM-1",
    stop_name: "3rd Ave & Pine St",
    stop_lat: "47.6100",
    stop_lon: "-122.3350",
    location_type: "0",
    parent_station: "station-1"
  };

  it("accepts platforms and expands the name without changing raw fields", () => {
    const result = createEligibleStop("US-WA-KCM", "King County Metro", {
      rowNumber: 2,
      fields
    });
    expect("stop" in result).toBe(true);
    if ("stop" in result) {
      expect(result.stop.locationKind).toBe("platform");
      expect(result.stop.stopNameExpanded).toBe("3rd Avenue & Pine Street");
      expect(result.stop.rawFields.stop_name).toBe(fields.stop_name);
      expect(result.stop.parentStation).toBe("station-1");
      expect(result.stop.identityTag).toEqual({
        key: "gtfs:stop_id:US-WA-KCM",
        value: "KCM-1"
      });
    }
  });

  it("accepts stations but excludes entrances and invalid coordinates", () => {
    expect(locationKindForValue("1")).toBe("station");
    expect(locationKindForValue("2")).toBeUndefined();
    expect(
      createEligibleStop("US-WA-KCM", "King County Metro", {
        rowNumber: 4,
        fields: { ...fields, location_type: "2" }
      })
    ).toEqual({
      diagnostic: expect.objectContaining({
        reason: "unsupported-location-type"
      })
    });
    expect(
      createEligibleStop("US-WA-KCM", "King County Metro", {
        rowNumber: 5,
        fields: { ...fields, stop_lat: "not-a-coordinate" }
      })
    ).toEqual({
      diagnostic: expect.objectContaining({ reason: "invalid-latitude" })
    });
  });

  it("maps declared source metadata directly and omits empty fields", () => {
    const profile = validateMappingProfile({
      schemaVersion: 1,
      id: "metadata",
      name: "Metadata",
      version: "1.0.0",
      sourceFeeds: [
        {
          id: "US-WA-KCM",
          displayName: "King County Metro",
          enabled: true,
          metadata: { network: "King County Metro" }
        }
      ],
      mappingRules: [
        {
          key: "network",
          value: { kind: "source-metadata", key: "network" }
        },
        {
          key: "operator",
          value: { kind: "field", field: "parent_station" }
        }
      ],
      candidateRadiusMeters: 50,
      autoIdRadiusMeters: 10
    });
    const result = createEligibleStop(
      "US-WA-KCM",
      "King County Metro",
      { rowNumber: 2, fields },
      { network: "King County Metro" }
    );
    if (!("stop" in result)) {
      throw new Error("fixture stop is invalid");
    }
    expect(evaluateMappingRules(profile, result.stop)).toEqual(
      expect.arrayContaining([
        { key: "network", value: "King County Metro" },
        { key: "gtfs:stop_id:US-WA-KCM", value: "KCM-1" }
      ])
    );
    expect(
      evaluateMappingRules(profile, {
        ...result.stop,
        parentStation: undefined,
        sourceFeedMetadata: {}
      })
    ).not.toEqual(expect.arrayContaining([{ key: "operator", value: "" }]));
  });
});
