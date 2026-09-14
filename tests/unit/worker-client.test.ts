import { afterEach, describe, expect, it } from "vitest";
import { STOCK_SOURCE_FEED_DEFINITIONS } from "../../src/domain/source-feed";
import { startArchiveImport } from "../../src/features/import/worker-client";

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;

  constructor() {
    MockWorker.instances.push(this);
  }

  postMessage(): void {}

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
});
