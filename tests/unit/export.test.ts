import { describe, expect, it } from "vitest";
import { createEligibleStop } from "../../src/domain/gtfs";
import { ChangeDraft } from "../../src/domain/change";
import { serializeOsmChange } from "../../src/infrastructure/osm/change-export";

function fixtureStop(id: string, kind: "platform" | "station" = "platform") {
  const result = createEligibleStop("US-WA-KCM", "King County Metro", {
    rowNumber: 2,
    fields: {
      stop_id: id,
      stop_name: "A & B",
      stop_lat: "47.123456789",
      stop_lon: "-122.123456789",
      location_type: kind === "station" ? "1" : "0"
    }
  });
  if (!("stop" in result)) {
    throw new Error("invalid fixture");
  }
  return result.stop;
}

describe("deterministic OSM Change export", () => {
  it("emits sorted creates, XML escaping, and exact metadata", () => {
    const stop = fixtureStop("2");
    const draft: ChangeDraft = {
      sessionId: "session-1",
      snapshotId: "snapshot-1",
      creates: [
        {
          feature: stop,
          state: "create-selected",
          latitude: stop.latitude,
          longitude: stop.longitude,
          tags: {
            name: 'A & "B"',
            "gtfs:stop_id:US-WA-KCM": stop.stopId
          }
        }
      ],
      modifications: []
    };
    const xml = serializeOsmChange(draft);
    expect(xml).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<osmChange version="0.6" generator="orcaboros">',
        "<create>",
        '  <node id="-1" lat="47.1234568" lon="-122.1234568">',
        '    <tag k="gtfs:stop_id:US-WA-KCM" v="2"/>',
        '    <tag k="name" v="A &amp; &quot;B&quot;"/>',
        "  </node>",
        "</create>",
        "</osmChange>",
        ""
      ].join("\n")
    );
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>\n');
    expect(xml).toContain('<osmChange version="0.6" generator="orcaboros">');
    expect(xml).toContain('id="-1" lat="47.1234568" lon="-122.1234568"');
    expect(xml).toContain("A &amp; &quot;B&quot;");
    expect(xml).not.toContain("<delete");
    expect(xml.endsWith("\n")).toBe(true);
  });

  it("serializes complete sorted modifications with selected removals", () => {
    const stop = fixtureStop("3");
    const draft: ChangeDraft = {
      sessionId: "session-1",
      snapshotId: "snapshot-1",
      creates: [],
      modifications: [
        {
          node: {
            id: 42,
            version: 7,
            latitude: stop.latitude,
            longitude: stop.longitude,
            tags: {
              name: "Old",
              "gtfs:stop_id:US-WA-KCM": "3",
              "gtfs:stop_id:US-WA-ET": "stale"
            }
          },
          featureIds: [stop.featureId],
          requiredIdentityTags: [stop.identityTag],
          tags: {
            name: "New",
            "gtfs:stop_id:US-WA-KCM": "3"
          }
        }
      ]
    };
    const xml = serializeOsmChange(draft);
    expect(xml).toContain("<modify>");
    expect(xml).toContain(
      '<node id="42" version="7" lat="47.1234568" lon="-122.1234568">'
    );
    expect(xml).toContain('    <tag k="name" v="New"/>');
    expect(xml).not.toContain("US-WA-ET");
    expect(xml).not.toContain("<create>");
  });
});
