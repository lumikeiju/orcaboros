import {
  boundsFromCoordinates,
  splitAntimeridianBounds,
  validateBounds
} from "../../domain/geo";
import { BoundingBox } from "../../domain/osm";
import { EligibleStop } from "../../domain/gtfs";
import { identityTagKey } from "../../domain/source-feed";

export const OVERPASS_QUERY_TIMEOUT_SECONDS = 60;
export const OVERPASS_CLIENT_TIMEOUT_MS = 75_000;
export const OVERPASS_MAX_RESPONSE_BYTES = 25 * 1024 * 1024;
export const OVERPASS_MAX_ELEMENTS = 50_000;

const CANDIDATE_TAG_CLAUSES: readonly [string, string][] = [
  ["public_transport", "platform"],
  ["public_transport", "station"],
  ["highway", "bus_stop"],
  ["railway", "station"],
  ["railway", "halt"],
  ["railway", "tram_stop"],
  ["amenity", "ferry_terminal"]
];

export type QueryExtent = {
  bounds: BoundingBox;
  query: string;
};

export type OverpassRequest = {
  body: string;
  headers: {
    "Content-Type": "application/x-www-form-urlencoded";
  };
};

export type OverpassErrorCategory =
  | "invalid-endpoint"
  | "cors"
  | "http"
  | "timeout"
  | "cancelled"
  | "malformed-data"
  | "size-limit"
  | "node-limit"
  | "invalid-extent";

export class OverpassRequestError extends Error {
  readonly category: OverpassErrorCategory;
  readonly status: number | undefined;

  constructor(
    category: OverpassErrorCategory,
    message: string,
    status?: number
  ) {
    super(message);
    this.name = "OverpassRequestError";
    this.category = category;
    this.status = status;
  }
}

export function validateOverpassEndpoint(endpoint: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch (error: unknown) {
    void error;
    throw new OverpassRequestError(
      "invalid-endpoint",
      "Enter a valid HTTPS Overpass endpoint"
    );
  }
  if (parsed.protocol !== "https:") {
    throw new OverpassRequestError(
      "invalid-endpoint",
      "The Overpass endpoint must use HTTPS"
    );
  }
  return parsed;
}

export function escapeOverpassStringLiteral(value: string): string {
  return value
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\r/gu, "\\r")
    .replace(/\n/gu, "\\n");
}

function formatCoordinate(value: number): string {
  return value.toFixed(7).replace(/\.?0+$/u, "");
}

function formatBounds(bounds: BoundingBox): string {
  return [
    formatCoordinate(bounds.south),
    formatCoordinate(bounds.west),
    formatCoordinate(bounds.north),
    formatCoordinate(bounds.east)
  ].join(",");
}

function candidateClauses(bounds: BoundingBox): string[] {
  const extent = formatBounds(bounds);
  return CANDIDATE_TAG_CLAUSES.map(
    ([key, value]) =>
      `  node["${escapeOverpassStringLiteral(key)}"="${escapeOverpassStringLiteral(value)}"](${extent});`
  );
}

function identityClauses(
  bounds: BoundingBox,
  identityKeys: readonly string[]
): string[] {
  const extent = formatBounds(bounds);
  return identityKeys.map(
    (key) => `  node["${escapeOverpassStringLiteral(key)}"](${extent});`
  );
}

export function buildOverpassQuery(
  bounds: BoundingBox,
  identityKeys: readonly string[]
): string {
  try {
    validateBounds(bounds);
  } catch (error: unknown) {
    throw new OverpassRequestError(
      "invalid-extent",
      error instanceof Error ? error.message : "The OSM extent is invalid"
    );
  }
  if (bounds.west === bounds.east) {
    throw new OverpassRequestError(
      "invalid-extent",
      "The OSM extent has no longitude width"
    );
  }
  const keys = [...new Set(identityKeys)];
  for (const key of keys) {
    if (!/^gtfs:stop_id:[A-Z0-9]+(?:-[A-Z0-9]+)*$/u.test(key)) {
      throw new OverpassRequestError(
        "invalid-extent",
        "The profile contains an invalid identity key"
      );
    }
  }
  const clauses = [
    ...candidateClauses(bounds),
    ...identityClauses(bounds, keys)
  ];
  return [
    `[out:json][timeout:${OVERPASS_QUERY_TIMEOUT_SECONDS}];`,
    "(",
    ...clauses,
    ");",
    "out meta;"
  ].join("\n");
}

export function buildOverpassRequests(
  bounds: BoundingBox,
  identityKeys: readonly string[]
): readonly QueryExtent[] {
  let split: readonly BoundingBox[];
  try {
    split = splitAntimeridianBounds(bounds);
  } catch (error) {
    throw new OverpassRequestError(
      "invalid-extent",
      error instanceof Error ? error.message : "The OSM extent is invalid"
    );
  }
  return split.map((part) => ({
    bounds: part,
    query: buildOverpassQuery(part, identityKeys)
  }));
}

export function buildOverpassRequest(query: string): OverpassRequest {
  return {
    body: new URLSearchParams({ data: query }).toString(),
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  };
}

export function workingBoundsForStops(
  stops: readonly Pick<EligibleStop, "latitude" | "longitude">[],
  candidateRadiusMeters: number
): BoundingBox {
  try {
    return boundsFromCoordinates(stops, candidateRadiusMeters);
  } catch (error) {
    throw new OverpassRequestError(
      "invalid-extent",
      error instanceof Error ? error.message : "The OSM extent is invalid"
    );
  }
}

export function identityKeysForSourceFeeds(
  sourceFeedIds: readonly string[]
): readonly string[] {
  return [
    ...new Set(
      sourceFeedIds.map((sourceFeedId) => identityTagKey(sourceFeedId))
    )
  ].sort();
}

export function sanitizeOverpassError(error: unknown): OverpassRequestError {
  if (error instanceof OverpassRequestError) {
    return error;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return new OverpassRequestError(
      "cancelled",
      "The Overpass request was cancelled"
    );
  }
  if (error instanceof TypeError) {
    return new OverpassRequestError(
      "cors",
      "The Overpass request was blocked by CORS"
    );
  }
  return new OverpassRequestError(
    "malformed-data",
    "The Overpass response was not usable"
  );
}
