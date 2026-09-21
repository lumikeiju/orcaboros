import { afterEach, describe, expect, it } from "vitest";
import { STOCK_SOURCE_FEED_DEFINITIONS } from "../../src/domain/source-feed";
import { startArchiveImport } from "../../src/features/import/worker-client";

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postedMessage: unknown;
  terminated = false;

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    this.postedMessage = message;
  }

  terminate(): void {
    this.terminated = true;
  }
}

const nativeWorker = globalThis.Worker;

afterEach(() => {
  MockWorker.instances = [];
  globalThis.Worker = nativeWorker;
});

describe("GTFS import worker client", () => {
  it("cancels the active worker without waiting for the import stream", async () => {
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    const handle = startArchiveImport(
      new File([], "US-WA-KCM.zip"),
      STOCK_SOURCE_FEED_DEFINITIONS
    );

    handle.cancel();

    await expect(handle.promise).rejects.toMatchObject({
      name: "AbortError",
      message: "The GTFS import was cancelled"
    });
    expect(MockWorker.instances[0]?.terminated).toBe(true);
  });

  it("reports runtime worker errors with their browser detail", async () => {
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    const handle = startArchiveImport(
      new File([], "US-WA-KCM.zip"),
      STOCK_SOURCE_FEED_DEFINITIONS
    );

    MockWorker.instances[0]?.onerror?.({
      message: "Uncaught DataCloneError"
    } as ErrorEvent);

    await expect(handle.promise).rejects.toThrow(
      "The GTFS import worker stopped unexpectedly: Uncaught DataCloneError"
    );
    expect(MockWorker.instances[0]?.terminated).toBe(true);
  });

  it("reconstructs valid stop IDs from the clone-safe worker result", async () => {
    globalThis.Worker = MockWorker as unknown as typeof Worker;
    const handle = startArchiveImport(
      new File([], "US-WA-KCM.zip"),
      STOCK_SOURCE_FEED_DEFINITIONS
    );
    const worker = MockWorker.instances[0];
    const request = worker?.postedMessage as { requestId: string };

    worker?.onmessage?.({
      data: {
        type: "complete",
        requestId: request.requestId,
        sourceFeedId: "US-WA-KCM",
        archiveFingerprint: "fingerprint",
        result: {
          sourceFeedId: "US-WA-KCM",
          sourceFeedName: "King County Metro",
          fields: ["stop_id"],
          eligibleStops: [],
          validStopIds: ["stop-1"],
          diagnostics: [],
          counts: {
            totalRows: 0,
            eligibleRows: 0,
            skippedRows: 0,
            invalidRows: 0,
            unsupportedLocationRows: 0
          }
        }
      }
    } as MessageEvent);

    await expect(handle.promise).resolves.toMatchObject({
      result: { validStopIds: new Set(["stop-1"]) }
    });
    expect(worker?.terminated).toBe(true);
  });
});
