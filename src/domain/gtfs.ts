import { identityTag } from "./source-feed";
import { expandStreetName } from "./street-name";

export type LocationKind = "platform" | "station";

export type RawStopFields = Readonly<Record<string, string>>;

export type GtfsStopRow = {
  rowNumber: number;
  fields: RawStopFields;
};

export type EligibleStop = {
  featureId: string;
  sourceFeedId: string;
  sourceFeedName: string;
  stopId: string;
  stopName: string;
  stopNameExpanded: string;
  latitude: number;
  longitude: number;
  locationKind: LocationKind;
  parentStation: string | undefined;
  sourceFeedMetadata?: Readonly<Record<string, string>>;
  rawFields: RawStopFields;
  identityTag: { key: string; value: string };
};

export type StopSkipReason =
  | "missing-stop-id"
  | "missing-stop-name"
  | "invalid-latitude"
  | "invalid-longitude"
  | "unsupported-location-type";

export type StopDiagnostic = {
  sourceFeedId: string;
  rowNumber: number;
  kind: "skipped";
  reason: StopSkipReason;
  detail: string;
};

export type FeedImportCounts = {
  totalRows: number;
  eligibleRows: number;
  skippedRows: number;
  invalidRows: number;
  unsupportedLocationRows: number;
};

export type FeedImportResult = {
  sourceFeedId: string;
  sourceFeedName: string;
  eligibleStops: readonly EligibleStop[];
  validStopIds: ReadonlySet<string>;
  diagnostics: readonly StopDiagnostic[];
  counts: FeedImportCounts;
};

export function isValidStopId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

export function locationKindForValue(
  value: string | undefined
): LocationKind | undefined {
  const normalized = value?.trim() ?? "";
  if (normalized === "" || normalized === "0") {
    return "platform";
  }
  if (normalized === "1") {
    return "station";
  }
  return undefined;
}

export function toFiniteCoordinate(
  value: string | undefined,
  minimum: number,
  maximum: number
): number | undefined {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return undefined;
  }
  const coordinate = Number(trimmed);
  return Number.isFinite(coordinate) &&
    coordinate >= minimum &&
    coordinate <= maximum
    ? coordinate
    : undefined;
}

export function createEligibleStop(
  sourceFeedId: string,
  sourceFeedName: string,
  row: GtfsStopRow,
  sourceFeedMetadata: Readonly<Record<string, string>> = {}
): { stop: EligibleStop } | { diagnostic: StopDiagnostic } {
  const stopId = row.fields.stop_id?.trim() ?? "";
  if (!isValidStopId(stopId)) {
    return {
      diagnostic: {
        sourceFeedId,
        rowNumber: row.rowNumber,
        kind: "skipped",
        reason: "missing-stop-id",
        detail:
          stopId.length === 0
            ? "stop_id is empty"
            : "stop_id is not valid OSM identity text"
      }
    };
  }

  const stopName = row.fields.stop_name?.trim() ?? "";
  if (stopName.length === 0 || stopName.length > 255) {
    return {
      diagnostic: {
        sourceFeedId,
        rowNumber: row.rowNumber,
        kind: "skipped",
        reason: "missing-stop-name",
        detail:
          stopName.length === 0
            ? "stop_name is empty"
            : "stop_name is not valid OSM text"
      }
    };
  }

  const latitude = toFiniteCoordinate(row.fields.stop_lat, -90, 90);
  if (latitude === undefined) {
    return {
      diagnostic: {
        sourceFeedId,
        rowNumber: row.rowNumber,
        kind: "skipped",
        reason: "invalid-latitude",
        detail: "stop_lat is missing or outside WGS84 bounds"
      }
    };
  }

  const longitude = toFiniteCoordinate(row.fields.stop_lon, -180, 180);
  if (longitude === undefined) {
    return {
      diagnostic: {
        sourceFeedId,
        rowNumber: row.rowNumber,
        kind: "skipped",
        reason: "invalid-longitude",
        detail: "stop_lon is missing or outside WGS84 bounds"
      }
    };
  }

  const locationKind = locationKindForValue(row.fields.location_type);
  if (locationKind === undefined) {
    return {
      diagnostic: {
        sourceFeedId,
        rowNumber: row.rowNumber,
        kind: "skipped",
        reason: "unsupported-location-type",
        detail: `location_type ${row.fields.location_type?.trim() || "(blank)"} is not supported`
      }
    };
  }

  return {
    stop: {
      featureId: `${sourceFeedId}:${stopId}`,
      sourceFeedId,
      sourceFeedName,
      stopId,
      stopName,
      stopNameExpanded: expandStreetName(stopName),
      latitude,
      longitude,
      locationKind,
      parentStation: row.fields.parent_station?.trim() || undefined,
      sourceFeedMetadata,
      rawFields: row.fields,
      identityTag: identityTag(sourceFeedId, stopId)
    }
  };
}
