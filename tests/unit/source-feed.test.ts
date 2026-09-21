import { describe, expect, it } from "vitest";
import {
  CONSOLIDATED_SOURCE_FEED_ID,
  deriveSourceFeedId,
  identityTag,
  STOCK_SOURCE_FEED_DEFINITIONS,
  validateSourceFeedSelection
} from "../../src/domain/source-feed";
import {
  createCustomProfileForFeedIds,
  getDefaultProfile,
  getProfileForFeedId
} from "../../src/profiles";
import {
  validateMappingProfile,
  ProfileValidationError
} from "../../src/domain/profile";

describe("source-feed identity", () => {
  it("derives an uppercase ID from a case-insensitive ZIP suffix", () => {
    expect(deriveSourceFeedId("US-WA-KCM.ZiP")).toBe("US-WA-KCM");
    expect(identityTag("US-WA-KCM", "12345")).toEqual({
      key: "gtfs:stop_id:US-WA-KCM",
      value: "12345"
    });
  });

  it("derives the consolidated feed so the picker can warn before profile lookup", () => {
    expect(deriveSourceFeedId("US-WA-PSC.zip")).toBe(
      CONSOLIDATED_SOURCE_FEED_ID
    );
    expect(
      validateSourceFeedSelection(
        [CONSOLIDATED_SOURCE_FEED_ID],
        STOCK_SOURCE_FEED_DEFINITIONS
      )
    ).toEqual([{ kind: "consolidated", sourceFeedId: "US-WA-PSC" }]);
  });

  it("keeps ZIPs with editable but unsupported filename IDs visible", () => {
    expect(deriveSourceFeedId("feed with spaces.zip")).toBe("FEED WITH SPACES");
  });

  it("rejects duplicate and unknown selections", () => {
    expect(
      validateSourceFeedSelection(
        ["US-WA-CT", "US-WA-CT", "US-WA-UNKNOWN"],
        STOCK_SOURCE_FEED_DEFINITIONS
      )
    ).toEqual([
      { kind: "duplicate", sourceFeedId: "US-WA-CT" },
      { kind: "unsupported", sourceFeedId: "US-WA-UNKNOWN" }
    ]);
  });

  it("registers one individual profile for every stock feed", () => {
    for (const source of STOCK_SOURCE_FEED_DEFINITIONS) {
      const profile = getProfileForFeedId(source.id);
      expect(profile?.sourceFeeds).toEqual([
        expect.objectContaining({ id: source.id })
      ]);
    }
  });

  it("combines all individual stock profiles for the default profile", () => {
    expect(getDefaultProfile().sourceFeeds.map((source) => source.id)).toEqual(
      STOCK_SOURCE_FEED_DEFINITIONS.map((source) => source.id)
    );
  });

  it("gives every stock feed profile its own default identity mapping", () => {
    for (const source of STOCK_SOURCE_FEED_DEFINITIONS) {
      const profile = getProfileForFeedId(source.id);
      if (profile === undefined) {
        throw new Error(`stock profile is missing for ${source.id}`);
      }
      expect(profile.mappingRules).toContainEqual({
        key: `gtfs:stop_id:${source.id}`,
        value: { kind: "field", field: "stop_id" },
        appliesTo: { sourceFeedIds: [source.id] }
      });
    }
  });

  it("maps Everett Transit stop codes to the OSM ref tag", () => {
    const profile = getProfileForFeedId("US-WA-ET");
    expect(profile?.mappingRules).toContainEqual({
      key: "ref",
      value: { kind: "field", field: "stop_code" },
      appliesTo: { sourceFeedIds: ["US-WA-ET"] }
    });
  });

  it("maps the cleaned GTFS stop name to the OSM name tag for every stock profile", () => {
    for (const source of STOCK_SOURCE_FEED_DEFINITIONS) {
      const profile = getProfileForFeedId(source.id);
      if (profile === undefined) {
        throw new Error(`stock profile is missing for ${source.id}`);
      }
      expect(profile.mappingRules).toContainEqual({
        key: "name",
        value: { kind: "field", field: "stop_name_expanded" }
      });
      expect(profile.mappingRules).not.toEqual(
        expect.arrayContaining([
          {
            key: "name",
            value: { kind: "field", field: "stop_name" }
          }
        ])
      );
    }
  });

  it("defaults street-name cleanup on for legacy profiles", () => {
    const profile = validateMappingProfile({
      schemaVersion: 1,
      id: "legacy-cleanup",
      name: "Legacy cleanup",
      version: "1.0.0",
      sourceFeeds: [
        { id: "US-WA-KCM", displayName: "King County Metro", enabled: true }
      ],
      mappingRules: [],
      candidateRadiusMeters: 50,
      autoIdRadiusMeters: 10
    });

    expect(profile.sourceFeeds[0]?.streetNameCleanup).toBe(true);
  });

  it("validates and preserves an explicit street-name cleanup setting", () => {
    const disabled = validateMappingProfile({
      schemaVersion: 1,
      id: "disabled-cleanup",
      name: "Disabled cleanup",
      version: "1.0.0",
      sourceFeeds: [
        {
          id: "US-WA-KCM",
          displayName: "King County Metro",
          enabled: true,
          streetNameCleanup: false
        }
      ],
      mappingRules: [],
      candidateRadiusMeters: 50,
      autoIdRadiusMeters: 10
    });
    expect(disabled.sourceFeeds[0]?.streetNameCleanup).toBe(false);

    expect(() =>
      validateMappingProfile({
        schemaVersion: 1,
        id: "invalid-cleanup",
        name: "Invalid cleanup",
        version: "1.0.0",
        sourceFeeds: [
          {
            id: "US-WA-KCM",
            displayName: "King County Metro",
            enabled: true,
            streetNameCleanup: "yes"
          }
        ],
        mappingRules: [],
        candidateRadiusMeters: 50,
        autoIdRadiusMeters: 10
      })
    ).toThrow(ProfileValidationError);
  });

  it("looks up a stock profile by normalized feed ID", () => {
    const profile = getProfileForFeedId("us-wa-kcm");
    expect(profile?.sourceFeeds).toEqual([
      expect.objectContaining({ id: "US-WA-KCM" })
    ]);
    expect(profile?.mappingRules).toEqual(
      expect.arrayContaining([
        {
          key: "gtfs:stop_id:US-WA-KCM",
          value: { kind: "field", field: "stop_id" },
          appliesTo: { sourceFeedIds: ["US-WA-KCM"] }
        }
      ])
    );
    expect(profile?.mappingRules).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "gtfs:stop_id:US-WA-ET"
        })
      ])
    );
    expect(profile?.mappingRules).not.toEqual(
      expect.arrayContaining([
        {
          key: "public_transport",
          value: { kind: "constant", value: "station" },
          appliesTo: { locationKinds: ["station"] }
        }
      ])
    );
    expect(getProfileForFeedId("US-WA-UNKNOWN")).toBeUndefined();
  });

  it("includes source-scoped identity mappings in new custom profiles", () => {
    const profile = createCustomProfileForFeedIds(["US-WA-NEW", "US-WA-OTHER"]);

    expect(profile.mappingRules).toEqual([
      {
        key: "gtfs:stop_id:US-WA-NEW",
        value: { kind: "field", field: "stop_id" },
        appliesTo: { sourceFeedIds: ["US-WA-NEW"] }
      },
      {
        key: "gtfs:stop_id:US-WA-OTHER",
        value: { kind: "field", field: "stop_id" },
        appliesTo: { sourceFeedIds: ["US-WA-OTHER"] }
      }
    ]);
  });

  it("does not allow a custom profile to re-enable US-WA-PSC", () => {
    expect(() =>
      validateMappingProfile({
        schemaVersion: 1,
        id: "unsafe",
        name: "Unsafe",
        version: "1.0.0",
        sourceFeeds: [
          { id: "US-WA-PSC", displayName: "Consolidated", enabled: true }
        ],
        mappingRules: [],
        candidateRadiusMeters: 50,
        autoIdRadiusMeters: 10
      })
    ).toThrow(ProfileValidationError);
  });
});
