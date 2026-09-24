import { ChangeDraft, DraftCreate, DraftModify } from "../../domain/change";
import { FeatureReviewState } from "../../domain/review";
import {
  isOsmWay,
  isValidOsmKey,
  isValidOsmValue,
  osmElementKey,
  OsmTagSet
} from "../../domain/osm";
import { lexicalCompare } from "../../domain/order";

const CHANGESET_HOST = "https://lumikeiju.dev/orcaboros/";
const CHANGESET_COMMENT =
  "Edit public transport features using GTFS data | #Orcaboros";

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
  if (isOsmWay(modify.node)) {
    return [
      `  <way id="${modify.node.id}" version="${modify.node.version}">`,
      ...modify.node.nodeRefs.map((nodeRef) => `    <nd ref="${nodeRef}"/>`),
      ...(tags.length > 0 ? tags.split("\n") : []),
      "  </way>"
    ].join("\n");
  }
  return [
    `  <node id="${modify.node.id}" version="${modify.node.version}" lat="${coordinate(
      modify.coordinates.latitude
    )}" lon="${coordinate(modify.coordinates.longitude)}">`,
    ...(tags.length > 0 ? tags.split("\n") : []),
    "  </node>"
  ].join("\n");
}

function changesetXml(): string {
  return [
    "<changeset>",
    `  <tag k="host" v="${escapeXml(CHANGESET_HOST)}"/>`,
    `  <tag k="comment" v="${escapeXml(CHANGESET_COMMENT)}"/>`,
    "</changeset>"
  ].join("\n");
}

function sortedCreates(draft: ChangeDraft): readonly DraftCreate[] {
  return [...draft.creates].sort((left, right) => {
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
}

function sortedModifications(draft: ChangeDraft): readonly DraftModify[] {
  return [...draft.modifications].sort(
    (left, right) => left.node.id - right.node.id
  );
}

function josmCreateXml(create: DraftCreate, id: number): string {
  const tags = tagXml(create.tags);
  return [
    `  <node id="${id}" visible="true" lat="${coordinate(create.latitude)}" lon="${coordinate(create.longitude)}">`,
    ...(tags.length > 0 ? tags.split("\n") : []),
    "  </node>"
  ].join("\n");
}

function josmModifyXml(modify: DraftModify): string {
  const tags = tagXml(modify.tags);
  if (isOsmWay(modify.node)) {
    return [
      `  <way id="${modify.node.id}" action="modify" version="${modify.node.version}" visible="true">`,
      ...modify.node.nodeRefs.map((nodeRef) => `    <nd ref="${nodeRef}"/>`),
      ...(tags.length > 0 ? tags.split("\n") : []),
      "  </way>"
    ].join("\n");
  }
  return [
    `  <node id="${modify.node.id}" action="modify" version="${modify.node.version}" visible="true" lat="${coordinate(
      modify.coordinates.latitude
    )}" lon="${coordinate(modify.coordinates.longitude)}">`,
    ...(tags.length > 0 ? tags.split("\n") : []),
    "  </node>"
  ].join("\n");
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
  const modifiedIds = new Set<string>();
  for (const modify of draft.modifications) {
    const elementLabel = isOsmWay(modify.node) ? "way" : "node";
    const elementId = osmElementKey(modify.node);
    if (modifiedIds.has(elementId)) {
      issues.push(
        `OSM ${elementLabel} ${modify.node.id} appears more than once`
      );
    }
    modifiedIds.add(elementId);
    if (
      !Number.isSafeInteger(modify.node.version) ||
      modify.node.version <= 0
    ) {
      issues.push(
        `OSM ${elementLabel} ${modify.node.id} has no valid snapshot version`
      );
    }
    for (const featureId of modify.featureIds) {
      if (featureId.length === 0) {
        issues.push(
          `OSM ${elementLabel} ${modify.node.id} has an empty feature claim`
        );
      }
    }
    if (
      !Number.isFinite(modify.coordinates.latitude) ||
      modify.coordinates.latitude < -90 ||
      modify.coordinates.latitude > 90 ||
      !Number.isFinite(modify.coordinates.longitude) ||
      modify.coordinates.longitude < -180 ||
      modify.coordinates.longitude > 180
    ) {
      issues.push(
        `OSM ${elementLabel} ${modify.node.id} has invalid coordinates`
      );
    }
  }
  if (issues.length > 0) {
    throw new ExportValidationError(issues);
  }
}

export function serializeOsmChange(draft: ChangeDraft): string {
  validateChangeDraft(draft);
  const creates = sortedCreates(draft);
  const modifications = sortedModifications(draft);
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

export function serializeJosmOsm(draft: ChangeDraft): string {
  validateChangeDraft(draft);
  const creates = sortedCreates(draft);
  const modifications = sortedModifications(draft);
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<osm version="0.6" generator="orcaboros">',
    changesetXml(),
    ...creates.map((create, index) => josmCreateXml(create, -(index + 1))),
    ...modifications.map((modify) => josmModifyXml(modify)),
    "</osm>",
    ""
  ].join("\n");
  validateSerializedJosmOsm(xml);
  return xml;
}

export function validateSerializedJosmOsm(xml: string): void {
  if (!xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')) {
    throw new ExportValidationError(["XML declaration is not exact"]);
  }
  if (!xml.endsWith("\n")) {
    throw new ExportValidationError(["XML output must end with a newline"]);
  }
  if (!xml.includes('<osm version="0.6" generator="orcaboros">')) {
    throw new ExportValidationError(["JOSM OSM root is invalid"]);
  }
  if (!xml.includes("<changeset>")) {
    throw new ExportValidationError(["JOSM changeset metadata is missing"]);
  }
}
