import { describe, expect, it } from "vitest";
import {
  buildOverpassQuery,
  buildOverpassRequests,
  buildOverpassRequest,
  escapeOverpassStringLiteral,
  parseOverpassNodesForTest,
  validateOverpassEndpoint
} from "../../src/infrastructure/osm";

describe("bounded Overpass requests", () => {
  it("constructs escaped node-only query clauses", () => {
    const query = buildOverpassQuery(
      { south: 47.5, west: -122.4, north: 47.7, east: -122.2 },
      ["gtfs:stop_id:US-WA-KCM"]
    );
    expect(query).toContain("[out:json][timeout:60];");
    expect(query).toContain('node["gtfs:stop_id:US-WA-KCM"]');
    expect(query).toContain("out meta;");
    expect(query).not.toMatch(/^\s*way/mu);
    expect(escapeOverpassStringLiteral('a"\\b')).toBe('a\\"\\\\b');
  });

  it("splits antimeridian extents", () => {
    const requests = buildOverpassRequests(
      { south: 10, west: 170, north: 20, east: -170 },
      []
    );
    expect(requests).toHaveLength(2);
    expect(requests[0].query).toContain("(10,170,20,180)");
    expect(requests[1].query).toContain("(10,-180,20,-170)");
  });

  it("requires HTTPS and keeps the endpoint out of the request body", () => {
    expect(() => validateOverpassEndpoint("http://example.test/api")).toThrow(
      "HTTPS"
    );
    const request = buildOverpassRequest("node(1);out meta;");
    expect(request.body).toContain("data=node%281%29%3Bout+meta%3B");
    expect(request.body).not.toContain("https");
  });

  it("parses nodes and ignores non-node elements", () => {
    expect(
      parseOverpassNodesForTest(
        JSON.stringify({
          elements: [
            { type: "node", id: 1, version: 2, lat: 47, lon: -122 },
            { type: "way", id: 2 }
          ]
        })
      )
    ).toHaveLength(1);
  });

  it("rejects malformed bounds and unverified identity keys before a request", () => {
    expect(() =>
      buildOverpassQuery({ south: 47, west: -122, north: 47, east: -122 }, [])
    ).toThrow("no longitude width");
    expect(() =>
      buildOverpassQuery({ south: 47, west: -122, north: 47.1, east: -121.9 }, [
        'gtfs:stop_id:US-WA-KCM"]];out meta;'
      ])
    ).toThrow("invalid identity key");
  });
});
