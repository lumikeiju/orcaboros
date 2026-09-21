import { importGtfsArchive } from "../infrastructure/gtfs/importer";
import { GtfsImportError } from "../infrastructure/gtfs/importer";
import {
  GtfsWorkerMessage,
  GtfsWorkerRequest,
  GtfsWorkerImportRequest
} from "./protocol";

const workerScope = self;
const activeImports = new Map<string, AbortController>();

function post(message: GtfsWorkerMessage): void {
  workerScope.postMessage(message);
}

function serializeResult(
  result: Awaited<ReturnType<typeof importGtfsArchive>>["result"]
): Extract<GtfsWorkerMessage, { type: "complete" }>["result"] {
  return {
    ...result,
    validStopIds: [...result.validStopIds]
  };
}

function safeError(error: unknown): { code: string; message: string } {
  if (error instanceof GtfsImportError) {
    return { code: error.code, message: error.detail };
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return { code: "cancelled", message: "The GTFS import was cancelled" };
  }
  return {
    code: "import-failed",
    message: "The GTFS archive could not be imported"
  };
}

workerScope.addEventListener(
  "message",
  (event: MessageEvent<GtfsWorkerRequest>) => {
    if (event.data.type !== "import") {
      activeImports.get(event.data.requestId)?.abort();
      return;
    }
    void runImport(event.data);
  }
);

async function runImport(request: GtfsWorkerImportRequest): Promise<void> {
  const controller = new AbortController();
  activeImports.set(request.requestId, controller);
  try {
    const imported = await importGtfsArchive(request.archive, {
      definitions: request.definitions,
      sourceFeedId: request.sourceFeedId,
      signal: controller.signal,
      onProgress: (progress) => {
        post({
          type: "progress",
          requestId: request.requestId,
          stage: progress.stage,
          rowsRead: progress.rowsRead,
          bytesRead: progress.bytesRead,
          totalBytes: progress.totalBytes
        });
      }
    });
    post({
      type: "complete",
      requestId: request.requestId,
      sourceFeedId: imported.sourceFeedId,
      archiveFingerprint: imported.archiveFingerprint,
      result: serializeResult(imported.result)
    });
  } catch (error) {
    post({
      type: "error",
      requestId: request.requestId,
      error: safeError(error)
    });
  } finally {
    activeImports.delete(request.requestId);
  }
}
