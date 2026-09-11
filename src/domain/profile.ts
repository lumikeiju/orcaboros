import { EligibleStop, LocationKind } from "./gtfs";
import { isValidOsmKey, isValidOsmValue, OsmTag } from "./osm";
import {
  CONSOLIDATED_SOURCE_FEED_ID,
  isValidSourceFeedId,
  SourceFeedDefinition,
  normalizeSourceFeedId
} from "./source-feed";

export const PROFILE_SCHEMA_VERSION = 1;

export type MappingField =
  | "stop_id"
  | "stop_name"
  | "stop_name_expanded"
  | "stop_lat"
  | "stop_lon"
  | "location_type"
  | "parent_station"
  | "source_feed_id"
  | "source_feed_name";

export type MappingValue =
  | { kind: "constant"; value: string }
  | { kind: "field"; field: MappingField }
  | { kind: "source-metadata"; key: string };

export type MappingApplicability = {
  sourceFeedIds?: readonly string[];
  locationKinds?: readonly LocationKind[];
};

export type MappingRule = {
  key: string;
  value: MappingValue;
  appliesTo?: MappingApplicability;
};

export type MappingProfile = {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  sourceFeeds: readonly SourceFeedDefinition[];
  mappingRules: readonly MappingRule[];
  candidateRadiusMeters: number;
  autoIdRadiusMeters: number;
};

export type ProfileValidationIssue = {
  path: string;
  message: string;
};

export class ProfileValidationError extends Error {
  readonly issues: readonly ProfileValidationIssue[];

  constructor(issues: readonly ProfileValidationIssue[]) {
    super(
      `Mapping profile is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"})`
    );
    this.name = "ProfileValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(
  value: unknown,
  path: string,
  issues: ProfileValidationIssue[]
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({ path, message: "must be a non-empty string" });
    return "";
  }
  return value;
}

function stringArray(
  value: unknown,
  path: string,
  issues: ProfileValidationIssue[]
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    issues.push({ path, message: "must be an array of strings" });
    return undefined;
  }
  return value.map((item) => item.trim()).filter((item) => item.length > 0);
}

const MAPPING_FIELDS: readonly MappingField[] = [
  "stop_id",
  "stop_name",
  "stop_name_expanded",
  "stop_lat",
  "stop_lon",
  "location_type",
  "parent_station",
  "source_feed_id",
  "source_feed_name"
];

function isMappingField(value: string): value is MappingField {
  return MAPPING_FIELDS.includes(value as MappingField);
}

export function validateMappingProfile(input: unknown): MappingProfile {
  const issues: ProfileValidationIssue[] = [];
  if (!isRecord(input)) {
    throw new ProfileValidationError([
      { path: "$", message: "must be an object" }
    ]);
  }

  if (input.schemaVersion !== PROFILE_SCHEMA_VERSION) {
    issues.push({ path: "schemaVersion", message: "must be 1" });
  }
  const id = stringValue(input.id, "id", issues);
  const name = stringValue(input.name, "name", issues);
  const version = stringValue(input.version, "version", issues);

  const sourceFeeds: SourceFeedDefinition[] = [];
  const sourceIds = new Set<string>();
  if (!Array.isArray(input.sourceFeeds) || input.sourceFeeds.length === 0) {
    issues.push({
      path: "sourceFeeds",
      message: "must contain at least one source feed"
    });
  } else {
    input.sourceFeeds.forEach((item, index) => {
      const path = `sourceFeeds[${index}]`;
      if (!isRecord(item)) {
        issues.push({ path, message: "must be an object" });
        return;
      }
      const sourceId = normalizeSourceFeedId(
        stringValue(item.id, `${path}.id`, issues)
      );
      const displayName = stringValue(
        item.displayName,
        `${path}.displayName`,
        issues
      );
      if (typeof item.enabled !== "boolean") {
        issues.push({ path: `${path}.enabled`, message: "must be a boolean" });
      }
      if (sourceId === CONSOLIDATED_SOURCE_FEED_ID) {
        issues.push({
          path: `${path}.id`,
          message: "US-WA-PSC cannot be configured"
        });
      }
      if (!isValidSourceFeedId(sourceId)) {
        issues.push({
          path: `${path}.id`,
          message: "is not a valid source-feed ID"
        });
      }
      if (sourceIds.has(sourceId)) {
        issues.push({
          path: `${path}.id`,
          message: "source-feed IDs must be unique"
        });
      }
      sourceIds.add(sourceId);
      let metadata: Record<string, string> | undefined;
      if (item.metadata !== undefined) {
        if (!isRecord(item.metadata)) {
          issues.push({
            path: `${path}.metadata`,
            message: "must be a string record"
          });
        } else {
          const entries = Object.entries(item.metadata);
          if (entries.some(([, value]) => typeof value !== "string")) {
            issues.push({
              path: `${path}.metadata`,
              message: "must be a string record"
            });
          } else {
            metadata = {};
            for (const [key, value] of entries) {
              if (typeof value === "string") {
                if (!isValidOsmKey(key) || !isValidOsmValue(value)) {
                  issues.push({
                    path: `${path}.metadata.${key}`,
                    message: "must contain safe OSM key/value text"
                  });
                }
                metadata[key] = value;
              }
            }
          }
        }
      }
      sourceFeeds.push({
        id: sourceId,
        displayName,
        enabled: item.enabled === true,
        metadata
      });
    });
  }

  const mappingRules: MappingRule[] = [];
  if (!Array.isArray(input.mappingRules)) {
    issues.push({ path: "mappingRules", message: "must be an array" });
  } else {
    input.mappingRules.forEach((item, index) => {
      const path = `mappingRules[${index}]`;
      if (!isRecord(item)) {
        issues.push({ path, message: "must be an object" });
        return;
      }
      const key = stringValue(item.key, `${path}.key`, issues);
      if (!isValidOsmKey(key)) {
        issues.push({ path: `${path}.key`, message: "is not a safe OSM key" });
      }
      if (/^gtfs:stop_id:/u.test(key)) {
        issues.push({
          path: `${path}.key`,
          message: "namespaced identity keys are generated from the source feed"
        });
      }
      if (!isRecord(item.value)) {
        issues.push({ path: `${path}.value`, message: "must be an object" });
        return;
      }
      const kind = item.value.kind;
      let mappingValue: MappingValue;
      if (kind === "constant") {
        const value = stringValue(
          item.value.value,
          `${path}.value.value`,
          issues
        );
        if (!isValidOsmValue(value)) {
          issues.push({
            path: `${path}.value.value`,
            message: "is not a safe OSM value"
          });
        }
        mappingValue = { kind, value };
      } else if (kind === "field") {
        const field = stringValue(
          item.value.field,
          `${path}.value.field`,
          issues
        );
        if (!isMappingField(field)) {
          issues.push({
            path: `${path}.value.field`,
            message: "is not a supported source field"
          });
        }
        mappingValue = {
          kind,
          field: isMappingField(field) ? field : "stop_id"
        };
      } else if (kind === "source-metadata") {
        const metadataKey = stringValue(
          item.value.key,
          `${path}.value.key`,
          issues
        );
        if (!/^[A-Za-z0-9_.:-]{1,64}$/u.test(metadataKey)) {
          issues.push({
            path: `${path}.value.key`,
            message: "must be a safe metadata key"
          });
        }
        mappingValue = { kind, key: metadataKey };
      } else {
        issues.push({
          path: `${path}.value.kind`,
          message: "must be constant, field, or source-metadata"
        });
        mappingValue = { kind: "constant", value: "" };
      }

      const applicability = isRecord(item.appliesTo)
        ? item.appliesTo
        : undefined;
      const rawSourceFeedIds = stringArray(
        applicability?.sourceFeedIds,
        `${path}.appliesTo.sourceFeedIds`,
        issues
      );
      const sourceFeedIds = rawSourceFeedIds?.map((sourceFeedId) => {
        const normalized = normalizeSourceFeedId(sourceFeedId);
        if (!sourceIds.has(normalized)) {
          issues.push({
            path: `${path}.appliesTo.sourceFeedIds`,
            message: `${normalized} is not configured in sourceFeeds`
          });
        }
        return normalized;
      });
      const rawLocationKinds = applicability?.locationKinds;
      let locationKinds: LocationKind[] | undefined;
      if (rawLocationKinds !== undefined) {
        if (
          !Array.isArray(rawLocationKinds) ||
          rawLocationKinds.some(
            (value) => value !== "platform" && value !== "station"
          )
        ) {
          issues.push({
            path: `${path}.appliesTo.locationKinds`,
            message: "must contain platform or station"
          });
        } else {
          locationKinds = [...rawLocationKinds];
        }
      }
      mappingRules.push({
        key,
        value: mappingValue,
        appliesTo:
          sourceFeedIds === undefined && locationKinds === undefined
            ? undefined
            : { sourceFeedIds, locationKinds }
      });
    });
  }

  const candidateRadiusMeters = numericRadius(
    input.candidateRadiusMeters,
    "candidateRadiusMeters",
    issues
  );
  const autoIdRadiusMeters = numericRadius(
    input.autoIdRadiusMeters,
    "autoIdRadiusMeters",
    issues
  );
  if (autoIdRadiusMeters > candidateRadiusMeters) {
    issues.push({
      path: "autoIdRadiusMeters",
      message: "cannot exceed candidateRadiusMeters"
    });
  }

  if (issues.length > 0) {
    throw new ProfileValidationError(issues);
  }
  return {
    schemaVersion: PROFILE_SCHEMA_VERSION,
    id,
    name,
    version,
    sourceFeeds,
    mappingRules,
    candidateRadiusMeters,
    autoIdRadiusMeters
  };
}

function numericRadius(
  value: unknown,
  path: string,
  issues: ProfileValidationIssue[]
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > 10000
  ) {
    issues.push({
      path,
      message: "must be a finite radius from 0 to 10000 meters"
    });
    return 0;
  }
  return value;
}

function applies(rule: MappingRule, stop: EligibleStop): boolean {
  const sourceFeedMatches =
    rule.appliesTo?.sourceFeedIds === undefined ||
    rule.appliesTo.sourceFeedIds.includes(stop.sourceFeedId);
  const locationMatches =
    rule.appliesTo?.locationKinds === undefined ||
    rule.appliesTo.locationKinds.includes(stop.locationKind);
  return sourceFeedMatches && locationMatches;
}

function fieldValue(field: MappingField, stop: EligibleStop): string {
  switch (field) {
    case "stop_id":
      return stop.stopId;
    case "stop_name":
      return stop.stopName;
    case "stop_name_expanded":
      return stop.stopNameExpanded;
    case "stop_lat":
      return String(stop.latitude);
    case "stop_lon":
      return String(stop.longitude);
    case "location_type":
      return stop.locationKind === "station" ? "1" : "0";
    case "parent_station":
      return stop.parentStation ?? "";
    case "source_feed_id":
      return stop.sourceFeedId;
    case "source_feed_name":
      return stop.sourceFeedName;
  }
}

export function evaluateMappingRules(
  profile: MappingProfile,
  stop: EligibleStop
): readonly OsmTag[] {
  const tags: OsmTag[] = [];
  for (const rule of profile.mappingRules) {
    if (!applies(rule, stop)) {
      continue;
    }
    const value =
      rule.value.kind === "constant"
        ? rule.value.value
        : rule.value.kind === "field"
          ? fieldValue(rule.value.field, stop)
          : (stop.sourceFeedMetadata?.[rule.value.key] ?? "");
    if (value.length === 0) {
      continue;
    }
    if (!isValidOsmKey(rule.key) || !isValidOsmValue(value)) {
      throw new Error(`Mapping rule produces an unsafe OSM tag: ${rule.key}`);
    }
    if (tags.some((tag) => tag.key === rule.key)) {
      throw new Error(`Mapping rules produce duplicate key: ${rule.key}`);
    }
    tags.push({ key: rule.key, value });
  }
  const identity = stop.identityTag;
  if (!tags.some((tag) => tag.key === identity.key)) {
    tags.push(identity);
  }
  return tags;
}
