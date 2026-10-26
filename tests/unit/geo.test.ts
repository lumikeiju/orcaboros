import { describe, expect, it } from "vitest";
import { boundsFromCoordinates, validateBounds } from "../../src/domain/geo";

describe("large feed extents", () => {
  it("handles more stops than the engine argument limit", () => {
    const coordinates = Array.from({ length: 200_000 }, (_, index) => ({
      latitude: 47 + (index % 100) / 1000,
      longitude: -122 + (index % 100) / 1000
    }));
    const bounds = boundsFromCoordinates(coordinates, 50);
    expect(() => validateBounds(bounds)).not.toThrow();
    expect(bounds.south).toBeLessThan(47);
    expect(bounds.north).toBeGreaterThan(47.099);
    expect(bounds.west).toBeLessThan(-122);
    expect(bounds.east).toBeGreaterThan(-121.901);
  });

  it("rejects nonfinite coordinates", () => {
    expect(() =>
      boundsFromCoordinates([{ latitude: NaN, longitude: 0 }], 50)
    ).toThrow("finite WGS84");
  });
});
