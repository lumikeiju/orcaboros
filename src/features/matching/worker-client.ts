import { EligibleStop } from "../../domain/gtfs";
import { InitialMatch } from "../../domain/matching";
import { OsmElement } from "../../domain/osm";
import type { MatchingWorkerMessage } from "../../workers/protocol";

export function matchStopsInWorker(
  stops: readonly EligibleStop[],
  nodes: readonly OsmElement[],
  candidateRadiusMeters: number,
  autoIdRadiusMeters: number,
  onProgress?: (processed: number, total: number) => void,
  signal?: AbortSignal
): Promise<ReadonlyMap<string, InitialMatch>> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Matching was cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(
      new URL("../../workers/matching.worker.ts", import.meta.url),
      { type: "module" }
    );
    const requestId = crypto.randomUUID();
    const cleanup = (): void => {
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const cancel = (): void =>
      fail(new DOMException("Matching was cancelled", "AbortError"));
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<MatchingWorkerMessage>) => {
      const message = event.data;
      if (message.requestId !== requestId) {
        return;
      }
      if (message.type === "match-progress") {
        onProgress?.(message.processed, message.total);
        return;
      }
      cleanup();
      if (message.type === "match-complete") {
        resolve(message.results);
      } else if (message.type === "match-error") {
        reject(new Error(message.message));
      }
    };
    worker.onerror = () => {
      fail(new Error("The matching worker stopped unexpectedly"));
    };
    worker.onmessageerror = () =>
      fail(new Error("The matching worker returned an unreadable result"));
    try {
      worker.postMessage({
        type: "match",
        requestId,
        stops,
        nodes,
        candidateRadiusMeters,
        autoIdRadiusMeters
      });
    } catch (error: unknown) {
      fail(
        error instanceof Error
          ? error
          : new Error("Matching could not be started")
      );
    }
  });
}
