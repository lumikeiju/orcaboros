import { describe, expect, it } from "vitest";
import {
  applyStreetNameCleanup,
  createEligibleStop,
  locationKindForValue
} from "../../src/domain/gtfs";
import {
  evaluateRemovalKeys,
  evaluateMappingRules,
  ProfileValidationError,
  validateMappingProfile
} from "../../src/domain/profile";
import { getProfileForFeedId } from "../../src/profiles";
import { mapStopToOsmTags } from "../../src/infrastructure/gtfs";

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

  it("maps only fields configured in the stock Everett profile", () => {
    const profile = getProfileForFeedId("US-WA-ET");
    if (profile === undefined) {
      throw new Error("stock Everett profile is missing");
    }
    const result = createEligibleStop("US-WA-ET", "Everett Transit", {
      rowNumber: 2,
      fields: {
        stop_id: "64",
        stop_name: "Merrill Creek Pkwy & Glenwood Ave - Westbound",
        stop_lat: "47.9",
        stop_lon: "-122.2",
        location_type: "0"
      }
    });
    if (!("stop" in result)) {
      throw new Error("Everett fixture stop is invalid");
    }

    const tags = mapStopToOsmTags(profile, result.stop);
    expect(tags.name).toBe(
      "Merrill Creek Parkway & Glenwood Avenue - Westbound"
    );
    expect(tags).not.toHaveProperty("gtfs:stop_id:US-WA-ET");
  });

  it("can disable street-name cleanup without changing the raw stop name", () => {
    const result = createEligibleStop(
      "US-WA-KCM",
      "King County Metro",
      {
        rowNumber: 2,
        fields
      },
      {},
      false
    );
    expect("stop" in result).toBe(true);
    if ("stop" in result) {
      expect(result.stop.stopName).toBe("3rd Ave & Pine St");
      expect(result.stop.stopNameExpanded).toBe("3rd Ave & Pine St");
    }
  });

  it("recomputes the expanded name when a profile setting changes", () => {
    const result = createEligibleStop("US-WA-KCM", "King County Metro", {
      rowNumber: 2,
      fields
    });
    if (!("stop" in result)) {
      throw new Error("fixture stop is invalid");
    }

    expect(applyStreetNameCleanup(result.stop, false).stopNameExpanded).toBe(
      "3rd Ave & Pine St"
    );
    expect(
      applyStreetNameCleanup(applyStreetNameCleanup(result.stop, false), true)
        .stopNameExpanded
    ).toBe("3rd Avenue & Pine Street");
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
    expect(profile.sourceFeeds[0]?.geometryTarget).toBe("osm");
    const result = createEligibleStop(
      "US-WA-KCM",
      "King County Metro",
      { rowNumber: 2, fields },
      { network: "King County Metro" }
    );
    if (!("stop" in result)) {
      throw new Error("fixture stop is invalid");
    }
    expect(evaluateMappingRules(profile, result.stop)).toContainEqual({
      key: "network",
      value: "King County Metro"
    });
    expect(evaluateMappingRules(profile, result.stop)).not.toContainEqual({
      key: result.stop.identityTag.key,
      value: result.stop.identityTag.value
    });
    expect(
      evaluateMappingRules(profile, {
        ...result.stop,
        parentStation: undefined,
        sourceFeedMetadata: {}
      })
    ).not.toEqual(expect.arrayContaining([{ key: "operator", value: "" }]));
  });

  it("maps an arbitrary field from the uploaded feed", () => {
    const profile = validateMappingProfile({
      schemaVersion: 1,
      id: "custom-field",
      name: "Custom field",
      version: "1.0.0",
      sourceFeeds: [
        { id: "US-WA-KCM", displayName: "King County Metro", enabled: true }
      ],
      mappingRules: [
        {
          key: "ref:zone",
          value: { kind: "field", field: "custom_zone" }
        }
      ],
      candidateRadiusMeters: 50,
      autoIdRadiusMeters: 10
    });
    const result = createEligibleStop("US-WA-KCM", "King County Metro", {
      rowNumber: 2,
      fields: { ...fields, custom_zone: "north" }
    });
    if (!("stop" in result)) {
      throw new Error("fixture stop is invalid");
    }
    expect(evaluateMappingRules(profile, result.stop)).toEqual(
      expect.arrayContaining([{ key: "ref:zone", value: "north" }])
    );
  });

  it("evaluates additional tags from the stop's source feed", () => {
    const profile = validateMappingProfile({
      schemaVersion: 1,
      id: "feed-specific-tags",
      name: "Feed-specific tags",
      version: "1.0.0",
      sourceFeeds: [
        {
          id: "US-WA-KCM",
          displayName: "King County Metro",
          enabled: true,
          additionalTags: [
            {
              key: "operator",
              value: { kind: "constant", value: "King County Metro" }
            }
          ]
        },
        {
          id: "US-WA-ST",
          displayName: "Sound Transit",
          enabled: true,
          additionalTags: [
            {
              key: "operator",
              value: { kind: "constant", value: "Sound Transit" }
            }
          ]
        }
      ],
      mappingRules: [
        {
          key: "gtfs:stop_id:US-WA-KCM",
          value: { kind: "field", field: "stop_id" },
          appliesTo: { sourceFeedIds: ["US-WA-KCM"] }
        },
        {
          key: "gtfs:stop_id:US-WA-ST",
          value: { kind: "field", field: "stop_id" },
          appliesTo: { sourceFeedIds: ["US-WA-ST"] }
        }
      ],
      candidateRadiusMeters: 50,
      autoIdRadiusMeters: 10
    });
    const kcmResult = createEligibleStop("US-WA-KCM", "King County Metro", {
      rowNumber: 2,
      fields
    });
    const stResult = createEligibleStop("US-WA-ST", "Sound Transit", {
      rowNumber: 2,
      fields
    });
    if (!("stop" in kcmResult) || !("stop" in stResult)) {
      throw new Error("fixture stops are invalid");
    }

    expect(evaluateMappingRules(profile, kcmResult.stop)).toEqual(
      expect.arrayContaining([{ key: "operator", value: "King County Metro" }])
    );
    expect(evaluateMappingRules(profile, stResult.stop)).toEqual(
      expect.arrayContaining([{ key: "operator", value: "Sound Transit" }])
    );
    expect(evaluateMappingRules(profile, kcmResult.stop)).not.toEqual(
      expect.arrayContaining([{ key: "operator", value: "Sound Transit" }])
    );
    expect(evaluateMappingRules(profile, kcmResult.stop)).toContainEqual({
      key: kcmResult.stop.identityTag.key,
      value: kcmResult.stop.identityTag.value
    });
    expect(evaluateMappingRules(profile, stResult.stop)).toContainEqual({
      key: stResult.stop.identityTag.key,
      value: stResult.stop.identityTag.value
    });
  });

  it("validates and scopes configured OSM key removals to their source feed", () => {
    const profile = validateMappingProfile({
      schemaVersion: 1,
      id: "feed-specific-removals",
      name: "Feed-specific removals",
      version: "1.0.0",
      sourceFeeds: [
        {
          id: "US-WA-KCM",
          displayName: "King County Metro",
          enabled: true,
          removeKeys: ["old_ref", "old:source"]
        },
        {
          id: "US-WA-ST",
          displayName: "Sound Transit",
          enabled: true,
          removeKeys: ["obsolete"]
        }
      ],
      mappingRules: [],
      candidateRadiusMeters: 50,
      autoIdRadiusMeters: 10
    });
    const kcmResult = createEligibleStop("US-WA-KCM", "King County Metro", {
      rowNumber: 2,
      fields
    });
    const stResult = createEligibleStop("US-WA-ST", "Sound Transit", {
      rowNumber: 2,
      fields
    });
    if (!("stop" in kcmResult) || !("stop" in stResult)) {
      throw new Error("fixture stops are invalid");
    }

    expect(profile.sourceFeeds[0]?.removeKeys).toEqual([
      "old_ref",
      "old:source"
    ]);
    expect(evaluateRemovalKeys(profile, kcmResult.stop)).toEqual([
      "old_ref",
      "old:source"
    ]);
    expect(evaluateRemovalKeys(profile, stResult.stop)).toEqual(["obsolete"]);

    expect(() =>
      validateMappingProfile({
        schemaVersion: 1,
        id: "invalid-removal-key",
        name: "Invalid removal key",
        version: "1.0.0",
        sourceFeeds: [
          {
            id: "US-WA-KCM",
            displayName: "King County Metro",
            enabled: true,
            removeKeys: ["unsafe\u0000key"]
          }
        ],
        mappingRules: [],
        candidateRadiusMeters: 50,
        autoIdRadiusMeters: 10
      })
    ).toThrow(ProfileValidationError);
  });

  it("migrates legacy global additional tags into their feed fields", () => {
    const profile = validateMappingProfile({
      schemaVersion: 1,
      id: "legacy-tags",
      name: "Legacy tags",
      version: "1.0.0",
      sourceFeeds: [
        {
          id: "US-WA-KCM",
          displayName: "King County Metro",
          enabled: true
        },
        {
          id: "US-WA-ST",
          displayName: "Sound Transit",
          enabled: true
        }
      ],
      mappingRules: [
        {
          key: "operator",
          value: { kind: "constant", value: "King County Metro" },
          appliesTo: { sourceFeedIds: ["US-WA-KCM"] }
        },
        {
          key: "network",
          value: { kind: "constant", value: "Puget Sound" }
        },
        {
          key: "name",
          value: { kind: "field", field: "stop_name" }
        }
      ],
      candidateRadiusMeters: 50,
      autoIdRadiusMeters: 10
    });

    expect(profile.mappingRules).toEqual([
      {
        key: "name",
        value: { kind: "field", field: "stop_name" },
        appliesTo: undefined
      }
    ]);
    expect(profile.sourceFeeds[0]?.additionalTags).toEqual([
      {
        key: "operator",
        value: { kind: "constant", value: "King County Metro" },
        appliesTo: {
          sourceFeedIds: ["US-WA-KCM"],
          locationKinds: undefined
        }
      },
      {
        key: "network",
        value: { kind: "constant", value: "Puget Sound" }
      }
    ]);
    expect(profile.sourceFeeds[1]?.additionalTags).toEqual([
      {
        key: "network",
        value: { kind: "constant", value: "Puget Sound" }
      }
    ]);
  });

  it("rejects an unsupported geometry target", () => {
    expect(() =>
      validateMappingProfile({
        schemaVersion: 1,
        id: "invalid-geometry-target",
        name: "Invalid geometry target",
        version: "1.0.0",
        sourceFeeds: [
          {
            id: "US-WA-KCM",
            displayName: "King County Metro",
            enabled: true,
            geometryTarget: "other"
          }
        ],
        mappingRules: [],
        candidateRadiusMeters: 50,
        autoIdRadiusMeters: 10
      })
    ).toThrow(ProfileValidationError);
  });
});
