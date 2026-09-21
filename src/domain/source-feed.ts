export const CONSOLIDATED_SOURCE_FEED_ID = "US-WA-PSC";

export type GeometryTarget = "gtfs" | "osm";

export const DEFAULT_GEOMETRY_TARGET: GeometryTarget = "osm";
export const DEFAULT_STREET_NAME_CLEANUP = true;

export type SourceFeedDefinition = {
  id: string;
  displayName: string;
  enabled: boolean;
  geometryTarget: GeometryTarget;
  streetNameCleanup?: boolean;
  metadata?: Readonly<Record<string, string>>;
};

export const STOCK_SOURCE_FEED_DEFINITIONS: readonly SourceFeedDefinition[] = [
  {
    id: "US-WA-CT",
    displayName: "Community Transit",
    enabled: true,
    geometryTarget: DEFAULT_GEOMETRY_TARGET,
    streetNameCleanup: DEFAULT_STREET_NAME_CLEANUP
  },
  {
    id: "US-WA-ET",
    displayName: "Everett Transit",
    enabled: true,
    geometryTarget: DEFAULT_GEOMETRY_TARGET,
    streetNameCleanup: DEFAULT_STREET_NAME_CLEANUP
  },
  {
    id: "US-WA-IT",
    displayName: "Intercity Transit",
    enabled: true,
    geometryTarget: DEFAULT_GEOMETRY_TARGET,
    streetNameCleanup: DEFAULT_STREET_NAME_CLEANUP
  },
  {
    id: "US-WA-KCM",
    displayName: "King County Metro",
    enabled: true,
    geometryTarget: DEFAULT_GEOMETRY_TARGET,
    streetNameCleanup: DEFAULT_STREET_NAME_CLEANUP
  },
  {
    id: "US-WA-KT",
    displayName: "Kitsap Transit",
    enabled: true,
    geometryTarget: DEFAULT_GEOMETRY_TARGET,
    streetNameCleanup: DEFAULT_STREET_NAME_CLEANUP
  },
  {
    id: "US-WA-PT",
    displayName: "Pierce Transit",
    enabled: true,
    geometryTarget: DEFAULT_GEOMETRY_TARGET,
    streetNameCleanup: DEFAULT_STREET_NAME_CLEANUP
  },
  {
    id: "US-WA-SCM",
    displayName: "Seattle Center Monorail",
    enabled: true,
    geometryTarget: DEFAULT_GEOMETRY_TARGET,
    streetNameCleanup: DEFAULT_STREET_NAME_CLEANUP
  },
  {
    id: "US-WA-ST",
    displayName: "Sound Transit",
    enabled: true,
    geometryTarget: DEFAULT_GEOMETRY_TARGET,
    streetNameCleanup: DEFAULT_STREET_NAME_CLEANUP
  },
  {
    id: "US-WA-WSF",
    displayName: "Washington State Ferries",
    enabled: true,
    geometryTarget: DEFAULT_GEOMETRY_TARGET,
    streetNameCleanup: DEFAULT_STREET_NAME_CLEANUP
  }
];

const SOURCE_FEED_ID_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/u;

export function normalizeSourceFeedId(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidSourceFeedId(value: string): boolean {
  const normalized = normalizeSourceFeedId(value);
  return (
    normalized.length <= 242 &&
    SOURCE_FEED_ID_PATTERN.test(normalized) &&
    normalized !== CONSOLIDATED_SOURCE_FEED_ID
  );
}

export function deriveSourceFeedId(fileName: string): string {
  const baseName = fileName.split(/[\\/]/u).pop() ?? "";
  if (!/\.zip$/iu.test(baseName)) {
    throw new Error("Selected source must be a .zip archive");
  }

  const sourceFeedId = normalizeSourceFeedId(baseName.slice(0, -4));
  return sourceFeedId;
}

export type SourceSelectionIssue =
  | { kind: "duplicate"; sourceFeedId: string }
  | { kind: "consolidated"; sourceFeedId: typeof CONSOLIDATED_SOURCE_FEED_ID }
  | { kind: "unsupported"; sourceFeedId: string };

export function validateSourceFeedSelection(
  sourceFeedIds: readonly string[],
  definitions: readonly SourceFeedDefinition[]
): readonly SourceSelectionIssue[] {
  const issues: SourceSelectionIssue[] = [];
  const seen = new Set<string>();
  const known = new Set(
    definitions
      .filter((definition) => definition.enabled)
      .map((definition) => normalizeSourceFeedId(definition.id))
  );

  for (const value of sourceFeedIds) {
    const sourceFeedId = normalizeSourceFeedId(value);
    if (seen.has(sourceFeedId)) {
      issues.push({ kind: "duplicate", sourceFeedId });
      continue;
    }
    seen.add(sourceFeedId);
    if (sourceFeedId === CONSOLIDATED_SOURCE_FEED_ID) {
      issues.push({ kind: "consolidated", sourceFeedId });
    } else if (!known.has(sourceFeedId)) {
      issues.push({ kind: "unsupported", sourceFeedId });
    }
  }
  return issues;
}

export function identityTagKey(sourceFeedId: string): string {
  const normalized = normalizeSourceFeedId(sourceFeedId);
  const key = `gtfs:stop_id:${normalized}`;
  if (
    normalized === CONSOLIDATED_SOURCE_FEED_ID ||
    !isValidSourceFeedId(normalized) ||
    key.length > 255
  ) {
    throw new Error("Invalid source-feed ID for an identity tag");
  }
  return key;
}

export function identityTag(
  sourceFeedId: string,
  stopId: string
): { key: string; value: string } {
  const value = stopId.trim();
  if (
    value.length === 0 ||
    value.length > 255 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error("A GTFS stop ID is required for an identity tag");
  }
  return { key: identityTagKey(sourceFeedId), value };
}
