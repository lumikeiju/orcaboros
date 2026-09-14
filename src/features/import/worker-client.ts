import { SourceFeedDefinition } from "../../domain/source-feed";
import { ImportedArchive } from "../../infrastructure/gtfs/importer";
import { GtfsWorkerMessage } from "../../workers/protocol";

export type ImportWorkerHandle = {
  promise: Promise<ImportedArchive>;
  cancel: () => void;
};

export function startArchiveImport(
  archive: File,
  definitions: readonly SourceFeedDefinition[],
  onProgress?: (stage: string, rowsRead: number) => void,
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
    worker.onmessage = (event: MessageEvent<GtfsWorkerMessage>) => {
      const message = event.data;
      if (message.requestId !== requestId) {
        return;
      }
      if (message.type === "progress") {
        onProgress?.(message.stage, message.rowsRead);
        return;
      }
      settled = true;
      worker.terminate();
      if (message.type === "complete") {
        resolve({
          sourceFeedId: message.sourceFeedId,
          archiveFingerprint: message.archiveFingerprint,
          result: message.result
        });
      } else {
        reject(new Error(message.error.message));
      }
    };
    worker.onerror = () => {
      settled = true;
      worker.terminate();
      reject(new Error("The GTFS import worker stopped unexpectedly"));
    };
    worker.postMessage({
      type: "import",
      requestId,
      archive,
      sourceFeedId,
      definitions
    });
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
  onProgress?: (stage: string, rowsRead: number) => void,
  sourceFeedId?: string
): Promise<ImportedArchive> {
  return startArchiveImport(archive, definitions, onProgress, sourceFeedId)
    .promise;
}
