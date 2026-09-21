import { describe, expect, it } from "vitest";
import { createEligibleStop } from "../../src/domain/gtfs";
import { ChangeDraft } from "../../src/domain/change";
import { OsmWay } from "../../src/domain/osm";
import {
  serializeJosmOsm,
  serializeOsmChange
} from "../../src/infrastructure/osm/change-export";

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
    expect(xml).not.toContain("<changeset>");
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
            latitude: 47.2,
            longitude: -122.2,
            tags: {
              name: "Old",
              "gtfs:stop_id:US-WA-KCM": "3",
              "gtfs:stop_id:US-WA-ET": "stale"
            }
          },
          coordinates: {
            latitude: 47.123456789,
            longitude: -122.123456789
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

  it("emits JOSM OSM metadata and upload actions", () => {
    const stop = fixtureStop("4");
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
            "gtfs:stop_id:US-WA-KCM": stop.stopId
          }
        }
      ],
      modifications: [
        {
          node: {
            id: 42,
            version: 7,
            latitude: 47.2,
            longitude: -122.2,
            tags: { "gtfs:stop_id:US-WA-KCM": stop.stopId }
          },
          coordinates: {
            latitude: 47.123456789,
            longitude: -122.123456789
          },
          featureIds: [stop.featureId],
          requiredIdentityTags: [stop.identityTag],
          tags: { "gtfs:stop_id:US-WA-KCM": stop.stopId }
        }
      ]
    };
    const xml = serializeJosmOsm(draft);
    expect(xml).toContain('<osm version="0.6" generator="orcaboros">');
    expect(xml).toContain("<changeset>");
    expect(xml).toContain(
      '<tag k="host" v="https://lumikeiju.dev/orcaboros/"/>'
    );
    expect(xml).toContain(
      '<tag k="comment" v="Edit public transport features using GTFS data | #Orcaboros"/>'
    );
    expect(xml).toContain(
      '<node id="-1" visible="true" lat="47.1234568" lon="-122.1234568">'
    );
    expect(xml).toContain(
      '<node id="42" action="modify" version="7" visible="true" lat="47.1234568" lon="-122.1234568">'
    );
    expect(xml).not.toContain("<osmChange>");
  });

  it("serializes tagged platform ways with their member references", () => {
    const stop = fixtureStop("5");
    const way: OsmWay = {
      type: "way",
      id: 77,
      version: 4,
      latitude: 47.2,
      longitude: -122.2,
      nodeRefs: [100, 101, 102],
      tags: { public_transport: "platform" }
    };
    const draft: ChangeDraft = {
      sessionId: "session-1",
      snapshotId: "snapshot-1",
      creates: [],
      modifications: [
        {
          node: way,
          coordinates: { latitude: way.latitude, longitude: way.longitude },
          featureIds: [stop.featureId],
          requiredIdentityTags: [stop.identityTag],
          tags: {
            public_transport: "platform",
            "gtfs:stop_id:US-WA-KCM": stop.stopId
          }
        }
      ]
    };

    const xml = serializeOsmChange(draft);

    expect(xml).toContain('<way id="77" version="4">');
    expect(xml).toContain('    <nd ref="100"/>');
    expect(xml).toContain('    <nd ref="102"/>');
    expect(xml).toContain('    <tag k="public_transport" v="platform"/>');
    expect(xml).not.toContain('<node id="77"');
  });
});
