import { EligibleStop } from "../../domain/gtfs";
import { InitialMatch } from "../../domain/matching";
import { OsmNode } from "../../domain/osm";
import type { MatchingMessage } from "../../workers/matching.worker";

export function matchStopsInWorker(
  stops: readonly EligibleStop[],
  nodes: readonly OsmNode[],
  candidateRadiusMeters: number,
  autoIdRadiusMeters: number,
  onProgress?: (processed: number, total: number) => void
): Promise<ReadonlyMap<string, InitialMatch>> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("../../workers/matching.worker.ts", import.meta.url),
      { type: "module" }
    );
    const requestId = crypto.randomUUID();
    worker.onmessage = (event: MessageEvent<MatchingMessage>) => {
      const message = event.data;
      if (message.requestId !== requestId) {
        return;
      }
      if (message.type === "match-progress") {
        onProgress?.(message.processed, message.total);
        return;
      }
      worker.terminate();
      if (message.type === "match-complete") {
        resolve(message.results);
      } else if (message.type === "match-error") {
        reject(new Error(message.message));
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("The matching worker stopped unexpectedly"));
    };
    worker.postMessage({
      type: "match",
      requestId,
      stops,
      nodes,
      candidateRadiusMeters,
      autoIdRadiusMeters
    });
  });
}
