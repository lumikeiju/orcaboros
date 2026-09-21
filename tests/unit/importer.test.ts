import { zipSync, strToU8 } from "fflate";
import { Blob as NodeBlob } from "node:buffer";
import { describe, expect, it } from "vitest";
import { importGtfsArchive } from "../../src/infrastructure/gtfs/importer";
import { STOCK_SOURCE_FEED_DEFINITIONS } from "../../src/domain/source-feed";

function archiveWithStops(csv: string, name = "US-WA-KCM.zip") {
  return Object.assign(new NodeBlob([zipSync({ "stops.txt": strToU8(csv) })]), {
    name
  });
}

describe("streaming GTFS importer", () => {
  it("reports byte progress while fingerprinting an archive", async () => {
    const archive = archiveWithStops(
      "stop_id,stop_name,stop_lat,stop_lon\nstop-1,Test,47,-122"
    );
    const progress: Array<{
      stage: string;
      bytesRead: number;
      totalBytes?: number;
    }> = [];

    await importGtfsArchive(archive, {
      definitions: STOCK_SOURCE_FEED_DEFINITIONS,
      onProgress: ({ stage, bytesRead, totalBytes }) => {
        progress.push({ stage, bytesRead, totalBytes });
      }
    });

    const fingerprintProgress = progress.filter(
      (item) => item.stage === "fingerprinting"
    );
    expect(fingerprintProgress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bytesRead: archive.size,
          totalBytes: archive.size
        })
      ])
    );
  });

  it("reads only stops.txt and retains valid IDs for excluded locations", async () => {
    const imported = await importGtfsArchive(
      archiveWithStops(
        [
          "stop_id,stop_name,stop_lat,stop_lon,location_type,parent_station",
          'platform-1,"Main, ""St',
          'North",47.6100,-122.3350,0,station-1',
          "station-1,Central Station,47.6200,-122.3400,1,",
          "entrance-1,Entrance,47.6201,-122.3401,2,station-1",
          "bad-coordinate,Bad,not-a-lat,-122.3,0,"
        ].join("\n")
      ),
      { definitions: STOCK_SOURCE_FEED_DEFINITIONS }
    );
    expect(imported.result.fields).toEqual([
      "stop_id",
      "stop_name",
      "stop_lat",
      "stop_lon",
      "location_type",
      "parent_station"
    ]);
    expect(imported.result.eligibleStops).toHaveLength(2);
    expect(imported.result.eligibleStops[0].stopName).toBe('Main, "St\nNorth');
    expect(imported.result.validStopIds).toEqual(
      new Set(["platform-1", "station-1", "entrance-1", "bad-coordinate"])
    );
    expect(imported.result.counts.unsupportedLocationRows).toBe(1);
    expect(imported.archiveFingerprint).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("rejects duplicate IDs across eligible and ineligible rows", async () => {
    await expect(
      importGtfsArchive(
        archiveWithStops(
          [
            "stop_id,stop_name,stop_lat,stop_lon,location_type",
            "same,One,47,-122,2",
            "same,Two,47,-122,0"
          ].join("\n")
        ),
        { definitions: STOCK_SOURCE_FEED_DEFINITIONS }
      )
    ).rejects.toMatchObject({ code: "duplicate-stop-id" });
  });

  it("uses an edited source feed ID when provided", async () => {
    const imported = await importGtfsArchive(
      archiveWithStops(
        "stop_id,stop_name,stop_lat,stop_lon\nstop-1,Edited,47,-122"
      ),
      {
        definitions: STOCK_SOURCE_FEED_DEFINITIONS,
        sourceFeedId: "US-WA-ST"
      }
    );

    expect(imported.sourceFeedId).toBe("US-WA-ST");
    expect(imported.result.eligibleStops[0]?.sourceFeedId).toBe("US-WA-ST");
  });

  it("passes the per-feed street-name cleanup setting to stop parsing", async () => {
    const definitions = STOCK_SOURCE_FEED_DEFINITIONS.map((definition) =>
      definition.id === "US-WA-KCM"
        ? { ...definition, streetNameCleanup: false }
        : definition
    );
    const imported = await importGtfsArchive(
      archiveWithStops(
        "stop_id,stop_name,stop_lat,stop_lon\nstop-1,3rd Ave & Pine St,47,-122"
      ),
      { definitions }
    );

    expect(imported.result.eligibleStops[0]?.stopNameExpanded).toBe(
      "3rd Ave & Pine St"
    );
  });
});
