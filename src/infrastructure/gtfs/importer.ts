import { sha256 } from "@noble/hashes/sha2.js";
import {
  createEligibleStop,
  EligibleStop,
  FeedImportCounts,
  FeedImportResult,
  GtfsStopRow,
  isValidStopId,
  StopDiagnostic
} from "../../domain/gtfs";
import {
  SourceFeedDefinition,
  deriveSourceFeedId,
  isValidSourceFeedId,
  normalizeSourceFeedId,
  validateSourceFeedSelection
} from "../../domain/source-feed";
import { CsvParseError, CsvStreamParser, rowToRecord } from "./csv";
import { NamedBlob, consumeZipEntry } from "./zip";

export type ImportProgressStage =
  "fingerprinting" | "reading-stops" | "validating" | "complete";

export type ImportProgress = {
  stage: ImportProgressStage;
  rowsRead: number;
  bytesRead: number;
  totalBytes?: number;
};

export type ImportOptions = {
  definitions: readonly SourceFeedDefinition[];
  sourceFeedId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: ImportProgress) => void;
};

export class GtfsImportError extends Error {
  readonly sourceFeedId: string;
  readonly code:
    | "unsupported-source"
    | "missing-columns"
    | "duplicate-stop-id"
    | "invalid-csv"
    | "zip";
  readonly detail: string;

  constructor(
    sourceFeedId: string,
    code: GtfsImportError["code"],
    detail: string
  ) {
    super(`GTFS import failed for ${sourceFeedId}: ${detail}`);
    this.name = "GtfsImportError";
    this.sourceFeedId = sourceFeedId;
    this.code = code;
    this.detail = detail;
  }
}

export type ImportedArchive = {
  sourceFeedId: string;
  archiveFingerprint: string;
  result: FeedImportResult;
};

const REQUIRED_COLUMNS = [
  "stop_id",
  "stop_name",
  "stop_lat",
  "stop_lon"
] as const;

function checkAbort(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException("The import was cancelled", "AbortError");
  }
}

export async function importGtfsArchive(
  archive: NamedBlob,
  options: ImportOptions
): Promise<ImportedArchive> {
  const sourceFeedId =
    options.sourceFeedId === undefined
      ? deriveSourceFeedId(archive.name)
      : normalizeSourceFeedId(options.sourceFeedId);
  if (!isValidSourceFeedId(sourceFeedId)) {
    throw new GtfsImportError(
      sourceFeedId,
      "unsupported-source",
      "source feed ID is invalid"
    );
  }
  const selectionIssues = validateSourceFeedSelection(
    [sourceFeedId],
    options.definitions
  );
  if (selectionIssues.length > 0) {
    throw new GtfsImportError(
      sourceFeedId,
      "unsupported-source",
      "source feed is not enabled"
    );
  }
  const definition = options.definitions.find(
    (item) => normalizeSourceFeedId(item.id) === sourceFeedId && item.enabled
  );
  if (definition === undefined) {
    throw new GtfsImportError(
      sourceFeedId,
      "unsupported-source",
      "source feed is not configured"
    );
  }

  const signal = options.signal ?? new AbortController().signal;
  const digest = sha256.create();
  const parser = new CsvStreamParser();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let headers: string[] | undefined;
  let rowNumber = 1;
  let rowsRead = 0;
  let bytesRead = 0;
  let eligibleRows = 0;
  let skippedRows = 0;
  let invalidRows = 0;
  let unsupportedLocationRows = 0;
  const eligibleStops: EligibleStop[] = [];
  const diagnostics: StopDiagnostic[] = [];
  const validStopIds = new Set<string>();
  const firstRowsByStopId = new Map<string, number>();
  const totalBytes =
    typeof archive.size === "number" && Number.isFinite(archive.size)
      ? archive.size
      : undefined;
  const fingerprintProgressInterval = Math.max(
    64 * 1024,
    Math.ceil((totalBytes ?? 0) / 100)
  );
  let lastFingerprintProgressBytes = 0;
  const reportProgress = (
    stage: ImportProgressStage,
    progressRowsRead: number
  ): void => {
    options.onProgress?.({
      stage,
      rowsRead: progressRowsRead,
      bytesRead,
      totalBytes
    });
  };

  reportProgress("fingerprinting", 0);
  const processRows = (rows: readonly (readonly string[])[]) => {
    for (const values of rows) {
      checkAbort(signal);
      if (headers === undefined) {
        headers = values.map((header) => header.trim());
        const missing = REQUIRED_COLUMNS.filter(
          (column) => !headers?.includes(column)
        );
        if (missing.length > 0) {
          throw new GtfsImportError(
            sourceFeedId,
            "missing-columns",
            `stops.txt is missing ${missing.join(", ")}`
          );
        }
        if (new Set(headers).size !== headers.length) {
          throw new GtfsImportError(
            sourceFeedId,
            "invalid-csv",
            "stops.txt has duplicate columns"
          );
        }
        continue;
      }

      rowNumber += 1;
      rowsRead += 1;
      const fields = rowToRecord(headers, values);
      const stopId = fields.stop_id.trim();
      if (isValidStopId(stopId)) {
        const firstRow = firstRowsByStopId.get(stopId);
        if (firstRow !== undefined) {
          throw new GtfsImportError(
            sourceFeedId,
            "duplicate-stop-id",
            `stop_id ${stopId} occurs on rows ${firstRow} and ${rowNumber}`
          );
        }
        firstRowsByStopId.set(stopId, rowNumber);
        validStopIds.add(stopId);
      }

      const parsed: GtfsStopRow = { rowNumber, fields };
      const result = createEligibleStop(
        sourceFeedId,
        definition.displayName,
        parsed,
        definition.metadata,
        definition.streetNameCleanup
      );
      if ("diagnostic" in result) {
        skippedRows += 1;
        invalidRows +=
          result.diagnostic.reason === "unsupported-location-type" ? 0 : 1;
        unsupportedLocationRows +=
          result.diagnostic.reason === "unsupported-location-type" ? 1 : 0;
        diagnostics.push(result.diagnostic);
      } else {
        eligibleRows += 1;
        eligibleStops.push(result.stop);
      }
      reportProgress("reading-stops", rowsRead);
    }
  };

  try {
    await consumeZipEntry(
      archive,
      "stops.txt",
      (chunk, final) => {
        checkAbort(signal);
        const text = decoder.decode(chunk, {
          stream: !final
        });
        processRows(parser.push(text, final));
      },
      signal,
      (chunk) => {
        checkAbort(signal);
        digest.update(chunk);
        bytesRead += chunk.byteLength;
        if (
          bytesRead - lastFingerprintProgressBytes >=
            fingerprintProgressInterval ||
          bytesRead === totalBytes
        ) {
          lastFingerprintProgressBytes = bytesRead;
          reportProgress("fingerprinting", rowsRead);
        }
      }
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    if (error instanceof GtfsImportError) {
      throw error;
    }
    if (error instanceof CsvParseError) {
      throw new GtfsImportError(sourceFeedId, "invalid-csv", error.message);
    }
    if (error instanceof TypeError) {
      throw new GtfsImportError(
        sourceFeedId,
        "invalid-csv",
        "stops.txt is not valid UTF-8"
      );
    }
    if (error instanceof Error) {
      throw new GtfsImportError(sourceFeedId, "zip", error.message);
    }
    throw new GtfsImportError(
      sourceFeedId,
      "zip",
      "the archive could not be read"
    );
  }
  if (headers === undefined) {
    throw new GtfsImportError(
      sourceFeedId,
      "missing-columns",
      "stops.txt is empty"
    );
  }

  reportProgress("validating", rowsRead);
  const result: FeedImportResult = {
    sourceFeedId,
    sourceFeedName: definition.displayName,
    fields: [...(headers ?? [])],
    eligibleStops,
    validStopIds,
    diagnostics,
    counts: {
      totalRows: rowsRead,
      eligibleRows,
      skippedRows,
      invalidRows,
      unsupportedLocationRows
    }
  };
  reportProgress("complete", rowsRead);
  return {
    sourceFeedId,
    archiveFingerprint: bytesToHex(digest.digest()),
    result
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
