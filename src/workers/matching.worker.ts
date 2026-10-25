import { matchStops } from "../infrastructure/osm/matching";
import {
  createProgressThrottleState,
  shouldPublishProgress
} from "../infrastructure/browser/progress";
import type { MatchingWorkerMessage, MatchingWorkerRequest } from "./protocol";

const workerScope = self;

workerScope.addEventListener(
  "message",
  (event: MessageEvent<MatchingWorkerRequest>) => {
    if (event.data.type !== "match") {
      return;
    }
    try {
      const progressThrottle = createProgressThrottleState();
      const results = matchStops(
        event.data.stops,
        event.data.nodes,
        event.data.candidateRadiusMeters,
        event.data.autoIdRadiusMeters,
        (progress) => {
          if (
            !shouldPublishProgress(
              progressThrottle,
              "matching",
              progress.processed === progress.total
            )
          ) {
            return;
          }
          workerScope.postMessage({
            type: "match-progress",
            requestId: event.data.requestId,
            ...progress
          } satisfies MatchingWorkerMessage);
        }
      );
      workerScope.postMessage({
        type: "match-complete",
        requestId: event.data.requestId,
        results
      } satisfies MatchingWorkerMessage);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? "Matching could not be completed"
          : "Matching failed for an unknown reason";
      workerScope.postMessage({
        type: "match-error",
        requestId: event.data.requestId,
        message
      } satisfies MatchingWorkerMessage);
    }
  }
);
