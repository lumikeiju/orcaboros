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
  onProgress?: (stage: string, rowsRead: number) => void
): ImportWorkerHandle {
  const worker = new Worker(
    new URL("../../workers/gtfs-import.worker.ts", import.meta.url),
    { type: "module" }
  );
  const requestId = crypto.randomUUID();
  let settled = false;
  const promise = new Promise<ImportedArchive>((resolve, reject) => {
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
      definitions
    });
  });
  return {
    promise,
    cancel: () => {
      if (!settled) {
        worker.postMessage({ type: "cancel", requestId });
      }
    }
  };
}

export function importArchiveInWorker(
  archive: File,
  definitions: readonly SourceFeedDefinition[],
  onProgress?: (stage: string, rowsRead: number) => void
): Promise<ImportedArchive> {
  return startArchiveImport(archive, definitions, onProgress).promise;
}
