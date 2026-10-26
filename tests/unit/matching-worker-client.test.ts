import { afterEach, describe, expect, it, vi } from "vitest";
import { matchStopsInWorker } from "../../src/features/matching/worker-client";

class MockMatchingWorker {
  static instances: MockMatchingWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();

  constructor() {
    MockMatchingWorker.instances.push(this);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  MockMatchingWorker.instances = [];
});

describe("matching worker lifecycle", () => {
  it("cancels matching immediately and terminates the worker", async () => {
    vi.stubGlobal("Worker", MockMatchingWorker);
    const controller = new AbortController();
    const result = matchStopsInWorker(
      [],
      [],
      50,
      10,
      undefined,
      controller.signal
    );
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(MockMatchingWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
  });

  it("does not create a worker for an already cancelled operation", async () => {
    vi.stubGlobal("Worker", MockMatchingWorker);
    const controller = new AbortController();
    controller.abort();
    await expect(
      matchStopsInWorker([], [], 50, 10, undefined, controller.signal)
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(MockMatchingWorker.instances).toHaveLength(0);
  });

  it("rejects unreadable worker messages instead of hanging", async () => {
    vi.stubGlobal("Worker", MockMatchingWorker);
    const result = matchStopsInWorker([], [], 50, 10);
    MockMatchingWorker.instances[0]?.onmessageerror?.();
    await expect(result).rejects.toThrow("unreadable result");
    expect(MockMatchingWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
  });
});
