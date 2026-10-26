import { afterEach, describe, expect, it, vi } from "vitest";
import { toOsmNode, toOsmWay } from "../../src/domain/osm";
import {
  parseOverpassElementsForTest,
  retrieveOverpassElements
} from "../../src/infrastructure/osm/client";

afterEach(() => vi.unstubAllGlobals());

describe("fail-closed Overpass responses", () => {
  it.each([
    { elements: [] },
    { elements: [{ type: "node", id: 1, version: 1, lat: 47, lon: -122 }] }
  ])(
    "rejects runtime-error remarks even with apparently usable elements",
    ({ elements }) => {
      expect(() =>
        parseOverpassElementsForTest(
          JSON.stringify({
            elements,
            remark:
              "runtime error: private endpoint https://secret.example/token"
          })
        )
      ).toThrow("incomplete query result");
      try {
        parseOverpassElementsForTest(
          JSON.stringify({ elements, remark: "https://secret.example/token" })
        );
      } catch (error: unknown) {
        expect(String(error)).not.toContain("secret.example");
      }
    }
  );

  it.each([
    { type: "node", id: 1, lat: 47, lon: -122 },
    { type: "node", id: 1, version: 0, lat: 47, lon: -122 },
    { type: "relation", id: 1, version: 1 }
  ])(
    "rejects invalid or unsupported elements instead of dropping them",
    (element) => {
      expect(() =>
        parseOverpassElementsForTest(JSON.stringify({ elements: [element] }))
      ).toThrow();
    }
  );

  it("does not send a request when cancellation already occurred", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      retrieveOverpassElements(
        "https://example.test/api",
        "query",
        controller.signal
      )
    ).rejects.toMatchObject({ category: "cancelled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts the request after an invalid result and sanitizes its error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ elements: [], remark: "runtime error" }))
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      retrieveOverpassElements("https://example.test/private-token", "query")
    ).rejects.toMatchObject({ category: "malformed-data" });
    const request: RequestInit = fetchMock.mock.calls[0]?.[1];
    expect(request.signal?.aborted).toBe(true);
  });
});

describe("OSM snapshot validation", () => {
  it("requires finite coordinates and positive versions", () => {
    expect(() =>
      toOsmNode({ type: "node", id: 1, version: 1, lat: NaN, lon: 0 })
    ).toThrow();
    expect(() =>
      toOsmNode({ type: "node", id: 1, version: -1, lat: 0, lon: 0 })
    ).toThrow();
    expect(() =>
      toOsmWay({
        type: "way",
        id: 1,
        version: 1,
        center: { lat: 0, lon: NaN },
        nodes: [1, 2]
      })
    ).toThrow();
    expect(() =>
      toOsmWay({
        type: "way",
        id: 1,
        version: 1,
        center: { lat: 0, lon: 0 },
        nodes: [1]
      })
    ).toThrow();
  });
});
