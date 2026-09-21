import { SourceFeedDefinition } from "../../domain/source-feed";
import { ImportedArchive } from "../../infrastructure/gtfs/importer";
import { GtfsWorkerMessage } from "../../workers/protocol";

export type ImportWorkerHandle = {
  promise: Promise<ImportedArchive>;
  cancel: () => void;
};

export type ImportProgressCallback = (
  stage: string,
  rowsRead: number,
  bytesRead: number,
  totalBytes?: number
) => void;

function workerErrorMessage(event: ErrorEvent): string {
  const detail = event.message.trim();
  return detail.length > 0
    ? `The GTFS import worker stopped unexpectedly: ${detail}`
    : "The GTFS import worker stopped unexpectedly";
}

export function startArchiveImport(
  archive: File,
  definitions: readonly SourceFeedDefinition[],
  onProgress?: ImportProgressCallback,
  sourceFeedId?: string
): ImportWorkerHandle {
  const worker = new Worker(
    new URL("../../workers/gtfs-import.worker.ts", import.meta.url),
    { type: "module" }
  );
  const requestId = crypto.randomUUID();
  let settled = false;
  let rejectPromise: ((reason?: unknown) => void) | undefined;
  const promise = new Promise<ImportedArchive>((resolve, reject) => {
    rejectPromise = reject;
    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      worker.terminate();
      reject(error);
    };
    worker.onmessage = (event: MessageEvent<GtfsWorkerMessage>) => {
      const message = event.data;
      if (message.requestId !== requestId) {
        return;
      }
      if (message.type === "progress") {
        onProgress?.(
          message.stage,
          message.rowsRead,
          message.bytesRead,
          message.totalBytes
        );
        return;
      }
      settled = true;
      worker.terminate();
      if (message.type === "complete") {
        resolve({
          sourceFeedId: message.sourceFeedId,
          archiveFingerprint: message.archiveFingerprint,
          result: {
            ...message.result,
            validStopIds: new Set(message.result.validStopIds)
          }
        });
      } else {
        reject(new Error(message.error.message));
      }
    };
    worker.onerror = (event) => {
      fail(new Error(workerErrorMessage(event)));
    };
    worker.onmessageerror = () => {
      fail(new Error("The GTFS import worker returned an unreadable result"));
    };
    try {
      worker.postMessage({
        type: "import",
        requestId,
        archive,
        sourceFeedId,
        definitions
      });
    } catch (error: unknown) {
      fail(
        error instanceof Error
          ? error
          : new Error("The GTFS import could not be started")
      );
    }
  });
  return {
    promise,
    cancel: () => {
      if (!settled) {
        settled = true;
        worker.terminate();
        rejectPromise?.(
          new DOMException("The GTFS import was cancelled", "AbortError")
        );
      }
    }
  };
}

export function importArchiveInWorker(
  archive: File,
  definitions: readonly SourceFeedDefinition[],
  onProgress?: ImportProgressCallback,
  sourceFeedId?: string
): Promise<ImportedArchive> {
  return startArchiveImport(archive, definitions, onProgress, sourceFeedId)
    .promise;
}
