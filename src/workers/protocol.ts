import type { EligibleStop, FeedImportResult } from "../domain/gtfs";
import type { InitialMatch } from "../domain/matching";
import type { OsmElement } from "../domain/osm";
import type { SourceFeedDefinition } from "../domain/source-feed";

export type WorkerErrorPayload = {
  code: string;
  message: string;
};

export type GtfsWorkerImportResult = Omit<FeedImportResult, "validStopIds"> & {
  validStopIds: readonly string[];
};

export type GtfsWorkerImportRequest = {
  type: "import";
  requestId: string;
  archive: File;
  sourceFeedId?: string;
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
      bytesRead: number;
      totalBytes?: number;
    }
  | {
      type: "complete";
      requestId: string;
      sourceFeedId: string;
      archiveFingerprint: string;
      result: GtfsWorkerImportResult;
    }
  | {
      type: "error";
      requestId: string;
      error: WorkerErrorPayload;
    };

export type MatchingWorkerRequest = {
  type: "match";
  requestId: string;
  stops: readonly EligibleStop[];
  nodes: readonly OsmElement[];
  candidateRadiusMeters: number;
  autoIdRadiusMeters: number;
};

export type MatchingWorkerMessage =
  | {
      type: "match-progress";
      requestId: string;
      processed: number;
      total: number;
    }
  | {
      type: "match-complete";
      requestId: string;
      results: ReadonlyMap<string, InitialMatch>;
    }
  | {
      type: "match-error";
      requestId: string;
      message: string;
    };

export type WorkerRequest = GtfsWorkerRequest | MatchingWorkerRequest;
