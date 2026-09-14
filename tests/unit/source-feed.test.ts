import { describe, expect, it } from "vitest";
import {
  CONSOLIDATED_SOURCE_FEED_ID,
  deriveSourceFeedId,
  identityTag,
  STOCK_SOURCE_FEED_DEFINITIONS,
  validateSourceFeedSelection
} from "../../src/domain/source-feed";
import { getProfileForFeedId, getPugetSoundProfile } from "../../src/profiles";
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

  it("keeps the stock profile registry exact", () => {
    expect(
      getPugetSoundProfile().sourceFeeds.map((source) => source.id)
    ).toEqual(STOCK_SOURCE_FEED_DEFINITIONS.map((source) => source.id));
  });

  it("looks up a stock profile by normalized feed ID", () => {
    expect(getProfileForFeedId("us-wa-kcm")?.sourceFeeds).toEqual([
      expect.objectContaining({ id: "US-WA-KCM" })
    ]);
    expect(getProfileForFeedId("US-WA-UNKNOWN")).toBeUndefined();
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
