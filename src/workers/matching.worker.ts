import { matchStops } from "../infrastructure/osm/matching";
import { GtfsWorkerMessage } from "./protocol";

export type MatchingRequest = {
  type: "match";
  requestId: string;
  stops: Parameters<typeof matchStops>[0];
  nodes: Parameters<typeof matchStops>[1];
  candidateRadiusMeters: number;
  autoIdRadiusMeters: number;
};

export type MatchingMessage =
  | GtfsWorkerMessage
  | {
      type: "match-progress";
      requestId: string;
      processed: number;
      total: number;
    }
  | {
      type: "match-complete";
      requestId: string;
      results: ReturnType<typeof matchStops>;
    }
  | {
      type: "match-error";
      requestId: string;
      message: string;
    };

self.addEventListener("message", (event: MessageEvent<MatchingRequest>) => {
  if (event.data.type !== "match") {
    return;
  }
  try {
    const results = matchStops(
      event.data.stops,
      event.data.nodes,
      event.data.candidateRadiusMeters,
      event.data.autoIdRadiusMeters,
      (progress) =>
        self.postMessage({
          type: "match-progress",
          requestId: event.data.requestId,
          ...progress
        } satisfies MatchingMessage)
    );
    self.postMessage({
      type: "match-complete",
      requestId: event.data.requestId,
      results
    } satisfies MatchingMessage);
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? "Matching could not be completed"
        : "Matching failed for an unknown reason";
    self.postMessage({
      type: "match-error",
      requestId: event.data.requestId,
      message
    } satisfies MatchingMessage);
  }
});
