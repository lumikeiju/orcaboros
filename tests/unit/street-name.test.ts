import { describe, expect, it } from "vitest";
import { cleanupStreetName, normalizeName } from "../../src/domain/street-name";

describe("US street-name cleanup", () => {
  it("converts all-uppercase names to first caps before expansion", () => {
    expect(cleanupStreetName("MAIN ST NE")).toBe("Main Street Northeast");
    expect(cleanupStreetName("3RD AVE & PINE ST")).toBe(
      "3rd Avenue & Pine Street"
    );
  });

  it("expands common, directional, and uncommon abbreviations", () => {
    expect(cleanupStreetName("N. 3RD AVE")).toBe("North 3rd Avenue");
    expect(cleanupStreetName("MAIN RDG")).toBe("Main Ridge");
    expect(cleanupStreetName("CR 123")).toBe("County Road 123");
    expect(cleanupStreetName("US HIGHWAY FS ROAD 12")).toBe(
      "US Highway Forest Service Road 12"
    );
  });

  it("expands regional direction and direction-bound abbreviations", () => {
    expect(cleanupStreetName("Colby Avenue & 43rd Street Se")).toBe(
      "Colby Avenue & 43rd Street Southeast"
    );
    expect(cleanupStreetName("Merrill Creek Parkway & 23rd Drive W - Eb")).toBe(
      "Merrill Creek Parkway & 23rd Drive West - Eastbound"
    );
    expect(cleanupStreetName("Walnut Street & 21st Street - Nb")).toBe(
      "Walnut Street & 21st Street - Northbound"
    );
    expect(cleanupStreetName("4th Avenue W & 116th Street Sw - Sb")).toBe(
      "4th Avenue West & 116th Street Southwest - Southbound"
    );
    expect(cleanupStreetName("Main Street & W Marine Drive")).toBe(
      "Main Street & West Marine Drive"
    );
  });

  it("keeps directional initials and street names that the validator excludes", () => {
    expect(cleanupStreetName("N. K. CHASE")).toBe("N. K. Chase");
    expect(cleanupStreetName("AVENUE N")).toBe("Avenue N");
    expect(cleanupStreetName("Mampaɬ Trail")).toBe("Mampaɬ Trail");
  });

  it("uses the same cleanup for name matching", () => {
    expect(normalizeName("MAIN ST NE")).toBe("main street northeast");
    expect(normalizeName("Main Street Northeast")).toBe(
      "main street northeast"
    );
  });
});
