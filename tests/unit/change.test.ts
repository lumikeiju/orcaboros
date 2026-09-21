import { describe, expect, it } from "vitest";
import { coordinatesForGeometryTarget } from "../../src/domain/change";

const feature = { latitude: 47.61, longitude: -122.33 };
const node = { latitude: 47.62, longitude: -122.34 };
const way = {
  type: "way" as const,
  latitude: 47.62,
  longitude: -122.34
};

describe("geometry target coordinates", () => {
  it("uses the GTFS point when GTFS is the geometry target", () => {
    expect(coordinatesForGeometryTarget("gtfs", feature, node)).toEqual(
      feature
    );
  });

  it("keeps the OSM point when OSM is the geometry target", () => {
    expect(coordinatesForGeometryTarget("osm", feature, node)).toEqual(node);
  });

  it("keeps a platform way center even when GTFS is the geometry target", () => {
    expect(coordinatesForGeometryTarget("gtfs", feature, way)).toEqual({
      latitude: way.latitude,
      longitude: way.longitude
    });
  });
});
