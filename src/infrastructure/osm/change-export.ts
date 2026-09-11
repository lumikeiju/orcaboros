import { ChangeDraft, DraftCreate, DraftModify } from "../../domain/change";
import { FeatureReviewState } from "../../domain/review";
import { identityTagKey } from "../../domain/source-feed";
import { isValidOsmKey, isValidOsmValue, OsmTagSet } from "../../domain/osm";
import { lexicalCompare } from "../../domain/order";

export class ExportValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(
      `OSM Change export is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"})`
    );
    this.name = "ExportValidationError";
    this.issues = issues;
  }
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/'/gu, "&apos;");
}

function coordinate(value: number): string {
  if (!Number.isFinite(value) || value < -180 || value > 180) {
    throw new ExportValidationError([
      "coordinates must be finite WGS84 values"
    ]);
  }
  const fixed = Object.is(value, -0) ? 0 : value;
  return fixed.toFixed(7);
}

function sortedTags(tags: OsmTagSet): readonly [string, string][] {
  const entries = Object.entries(tags);
  const invalid = entries.filter(
    ([key, value]) => !isValidOsmKey(key) || !isValidOsmValue(value)
  );
  if (invalid.length > 0) {
    throw new ExportValidationError([
      "tag keys and values must be valid OSM strings"
    ]);
  }
  return entries.sort(([left], [right]) => lexicalCompare(left, right));
}

function tagXml(tags: OsmTagSet): string {
  return sortedTags(tags)
    .map(
      ([key, value]) =>
        `    <tag k="${escapeXml(key)}" v="${escapeXml(value)}"/>`
    )
    .join("\n");
}

function createXml(create: DraftCreate, id: number): string {
  const tags = tagXml(create.tags);
  return [
    `  <node id="${id}" lat="${coordinate(create.latitude)}" lon="${coordinate(create.longitude)}">`,
    ...(tags.length > 0 ? tags.split("\n") : []),
    "  </node>"
  ].join("\n");
}

function modifyXml(modify: DraftModify): string {
  const tags = tagXml(modify.tags);
  return [
    `  <node id="${modify.node.id}" version="${modify.node.version}" lat="${coordinate(
      modify.node.latitude
    )}" lon="${coordinate(modify.node.longitude)}">`,
    ...(tags.length > 0 ? tags.split("\n") : []),
    "  </node>"
  ].join("\n");
}

function validateTagsContainIdentity(
  sourceFeedId: string,
  stopId: string,
  tags: OsmTagSet,
  context: string,
  issues: string[]
): void {
  const key = identityTagKey(sourceFeedId);
  if (tags[key] !== stopId) {
    issues.push(`${context} is missing required identity ${key}=${stopId}`);
  }
}

export function validateChangeDraft(draft: ChangeDraft): void {
  const issues: string[] = [];
  if (draft.sessionId.length === 0 || draft.snapshotId.length === 0) {
    issues.push("session and snapshot IDs are required");
  }
  const createIds = new Set<number>();
  for (const create of draft.creates) {
    if (create.state !== "create-selected") {
      issues.push(
        `${create.feature.featureId} is not explicitly selected for creation`
      );
    }
    validateTagsContainIdentity(
      create.feature.sourceFeedId,
      create.feature.stopId,
      create.tags,
      create.feature.featureId,
      issues
    );
    const duplicateKeys = Object.keys(create.tags).filter(
      (key, index, keys) => keys.indexOf(key) !== index
    );
    if (duplicateKeys.length > 0) {
      issues.push(`${create.feature.featureId} has duplicate tag keys`);
    }
    const allocatedId = -(createIds.size + 1);
    if (createIds.has(allocatedId)) {
      issues.push("create IDs are not unique");
    }
    createIds.add(allocatedId);
    if (
      !Number.isFinite(create.latitude) ||
      create.latitude < -90 ||
      create.latitude > 90 ||
      !Number.isFinite(create.longitude) ||
      create.longitude < -180 ||
      create.longitude > 180
    ) {
      issues.push(`${create.feature.featureId} has invalid coordinates`);
    }
  }
  const modifiedIds = new Set<number>();
  for (const modify of draft.modifications) {
    if (modifiedIds.has(modify.node.id)) {
      issues.push(`OSM node ${modify.node.id} appears more than once`);
    }
    modifiedIds.add(modify.node.id);
    if (
      !Number.isSafeInteger(modify.node.version) ||
      modify.node.version <= 0
    ) {
      issues.push(`OSM node ${modify.node.id} has no valid snapshot version`);
    }
    for (const featureId of modify.featureIds) {
      if (featureId.length === 0) {
        issues.push(`OSM node ${modify.node.id} has an empty feature claim`);
      }
    }
    const identityKeys = new Set<string>();
    for (const identity of modify.requiredIdentityTags) {
      if (identityKeys.has(identity.key)) {
        issues.push(`OSM node ${modify.node.id} has duplicate identity claims`);
      }
      identityKeys.add(identity.key);
      if (modify.tags[identity.key] !== identity.value) {
        issues.push(
          `OSM node ${modify.node.id} is missing required identity ${identity.key}=${identity.value}`
        );
      }
    }
  }
  if (issues.length > 0) {
    throw new ExportValidationError(issues);
  }
}

export function serializeOsmChange(draft: ChangeDraft): string {
  validateChangeDraft(draft);
  const creates = [...draft.creates].sort((left, right) => {
    const kind = lexicalCompare(
      left.feature.locationKind,
      right.feature.locationKind
    );
    if (kind !== 0) {
      return kind;
    }
    const source = lexicalCompare(
      left.feature.sourceFeedId,
      right.feature.sourceFeedId
    );
    return source !== 0
      ? source
      : lexicalCompare(left.feature.stopId, right.feature.stopId);
  });
  const modifications = [...draft.modifications].sort(
    (left, right) => left.node.id - right.node.id
  );
  const sections: string[] = [];
  if (creates.length > 0) {
    sections.push(
      [
        "<create>",
        ...creates.map((create, index) => createXml(create, -(index + 1))),
        "</create>"
      ].join("\n")
    );
  }
  if (modifications.length > 0) {
    sections.push(
      [
        "<modify>",
        ...modifications.map((modify) => modifyXml(modify)),
        "</modify>"
      ].join("\n")
    );
  }
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<osmChange version="0.6" generator="orcaboros">',
    ...sections,
    "</osmChange>",
    ""
  ].join("\n");
  validateSerializedOsmChange(xml);
  return xml;
}

export function validateSerializedOsmChange(xml: string): void {
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')) {
    throw new ExportValidationError(["XML declaration is not exact"]);
  }
  if (!xml.endsWith("\n")) {
    throw new ExportValidationError(["XML output must end with a newline"]);
  }
  if (!xml.includes('<osmChange version="0.6" generator="orcaboros">')) {
    throw new ExportValidationError(["OSM Change root is invalid"]);
  }
  if (/<delete>/u.test(xml) || /<delete\b/u.test(xml)) {
    throw new ExportValidationError(["delete sections are not supported"]);
  }
}
