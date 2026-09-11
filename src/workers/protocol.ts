import { FeedImportResult } from "../domain/gtfs";
import { SourceFeedDefinition } from "../domain/source-feed";

export type WorkerErrorPayload = {
  code: string;
  message: string;
};

export type GtfsWorkerImportRequest = {
  type: "import";
  requestId: string;
  archive: File;
  definitions: readonly SourceFeedDefinition[];
};

export type GtfsWorkerRequest =
  | GtfsWorkerImportRequest
  | {
      type: "cancel";
      requestId: string;
    };

export type GtfsWorkerMessage =
  | {
      type: "progress";
      requestId: string;
      stage: string;
      rowsRead: number;
    }
  | {
      type: "complete";
      requestId: string;
      sourceFeedId: string;
      archiveFingerprint: string;
      result: FeedImportResult;
    }
  | {
      type: "error";
      requestId: string;
      error: WorkerErrorPayload;
    };

export type MatchingWorkerRequest = {
  type: "match";
  requestId: string;
};

export type WorkerRequest = GtfsWorkerRequest | MatchingWorkerRequest;
