import { describe, expect, it } from "vitest";
import { createEligibleStop } from "../../src/domain/gtfs";
import {
  mappingFieldValue,
  sourceMetadataValue
} from "../../src/domain/profile";
import {
  buildTagProposals,
  computePostChangeTags
} from "../../src/domain/review";
import { rowToRecord } from "../../src/infrastructure/gtfs/csv";
import { mapStopToOsmTags } from "../../src/infrastructure/gtfs/mapping";
import {
  createCustomProfileForFeedIds,
  parseProfileJson,
  serializeProfile
} from "../../src/profiles";

function fixtureStop() {
  const result = createEligibleStop("CUSTOM", "Custom", {
    rowNumber: 2,
    fields: rowToRecord(
      [
        "stop_id",
        "stop_name",
        "stop_lat",
        "stop_lon",
        "__proto__",
        "constructor"
      ],
      [
        "1",
        "Test stop",
        "47",
        "-122",
        "literal prototype field",
        "literal constructor field"
      ]
    )
  });
  if (!("stop" in result)) {
    throw new Error("Invalid fixture");
  }
  return result.stop;
}

describe("literal mapping records and editable profile drafts", () => {
  it("preserves literal special field names without reading inherited properties", () => {
    const stop = fixtureStop();
    expect(mappingFieldValue("__proto__", stop)).toBe(
      "literal prototype field"
    );
    expect(mappingFieldValue("constructor", stop)).toBe(
      "literal constructor field"
    );
    expect(mappingFieldValue("toString", stop)).toBe("");
    expect(sourceMetadataValue("constructor", stop)).toBe("");
  });

  it("preserves literal OSM keys while computing reviewed output", () => {
    const profile = createCustomProfileForFeedIds(["CUSTOM"]);
    const stop = fixtureStop();
    const tags = mapStopToOsmTags(
      {
        ...profile,
        mappingRules: [
          {
            key: "__proto__",
            value: { kind: "constant", value: "literal tag" }
          }
        ]
      },
      stop
    );
    expect(Object.hasOwn(tags, "__proto__")).toBe(true);
    expect(tags.__proto__).toBe("literal tag");
    const reviewed = computePostChangeTags(
      {},
      buildTagProposals(undefined, tags)
    );
    expect(Object.hasOwn(reviewed, "__proto__")).toBe(true);
    expect(reviewed.__proto__).toBe("literal tag");
  });

  it("omits incomplete editor rows from exported profiles so they round-trip", () => {
    const profile = createCustomProfileForFeedIds(["CUSTOM"]);
    const draft = {
      ...profile,
      sourceFeeds: profile.sourceFeeds.map((sourceFeed) => ({
        ...sourceFeed,
        additionalTags: [
          {
            key: "",
            value: { kind: "constant" as const, value: "unfinished" }
          },
          { key: "note", value: { kind: "constant" as const, value: "" } }
        ],
        removeKeys: [""]
      }))
    };
    expect(mapStopToOsmTags(draft, fixtureStop())).toEqual({});
    const restored = parseProfileJson(serializeProfile(draft));
    expect(restored.sourceFeeds[0]?.additionalTags).toEqual([]);
    expect(restored.sourceFeeds[0]?.removeKeys).toEqual([]);
  });
});
