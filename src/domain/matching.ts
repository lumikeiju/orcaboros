import { EligibleStop } from "./gtfs";
import { haversineDistanceMeters } from "./geo";
import { OsmNode } from "./osm";
import { identityTagKey } from "./source-feed";
import { normalizeName } from "./street-name";

export type MatchEvidence =
  | { kind: "exact-identity"; key: string; value: string }
  | { kind: "expanded-name"; value: string }
  | { kind: "distance"; meters: number };

export type CandidateMatch = {
  node: OsmNode;
  distanceMeters: number;
  evidence: readonly MatchEvidence[];
  exactIdentity: boolean;
  expandedNameEqual: boolean;
};

export type InitialMatch =
  | { kind: "auto-matched"; candidate: CandidateMatch }
  | { kind: "review"; candidates: readonly CandidateMatch[] }
  | { kind: "no-candidates"; candidates: readonly [] };

export class NodeSpatialIndex {
  private readonly buckets = new Map<string, OsmNode[]>();
  private readonly cellDegrees: number;
  private readonly longitudeCells: number;

  constructor(nodes: readonly OsmNode[], expectedRadiusMeters = 50) {
    if (!Number.isFinite(expectedRadiusMeters) || expectedRadiusMeters <= 0) {
      throw new Error("Spatial index radius must be positive");
    }
    this.cellDegrees = Math.max(expectedRadiusMeters / 111_320, 0.0001);
    this.longitudeCells = Math.ceil(360 / this.cellDegrees);
    nodes.forEach((node) => {
      const key = this.key(node.latitude, node.longitude);
      const bucket = this.buckets.get(key) ?? [];
      bucket.push(node);
      this.buckets.set(key, bucket);
    });
  }

  nearby(
    latitude: number,
    longitude: number,
    radiusMeters: number
  ): readonly OsmNode[] {
    const latitudePadding = radiusMeters / 111_320;
    const longitudePadding =
      radiusMeters /
      (111_320 * Math.max(Math.cos((latitude * Math.PI) / 180), 0.01));
    const minLatitude = this.latitudeCell(latitude - latitudePadding);
    const maxLatitude = this.latitudeCell(latitude + latitudePadding);
    const centerLongitude = this.longitudeCell(longitude);
    const longitudePaddingCells = Math.ceil(
      longitudePadding / this.cellDegrees
    );
    const nodes: OsmNode[] = [];
    for (let latCell = minLatitude; latCell <= maxLatitude; latCell += 1) {
      for (
        let offset = -longitudePaddingCells;
        offset <= longitudePaddingCells;
        offset += 1
      ) {
        const lonCell =
          (centerLongitude + offset + this.longitudeCells) %
          this.longitudeCells;
        const bucket = this.buckets.get(`${latCell}:${lonCell}`);
        if (bucket !== undefined) {
          nodes.push(...bucket);
        }
      }
    }
    return nodes;
  }

  private key(latitude: number, longitude: number): string {
    return `${this.latitudeCell(latitude)}:${this.longitudeCell(longitude)}`;
  }

  private latitudeCell(latitude: number): number {
    return Math.floor((latitude + 90) / this.cellDegrees);
  }

  private longitudeCell(longitude: number): number {
    const normalized = (((longitude + 180) % 360) + 360) % 360;
    return Math.floor(normalized / this.cellDegrees) % this.longitudeCells;
  }
}

export function rankCandidates(
  stop: EligibleStop,
  nodes: readonly OsmNode[],
  candidateRadiusMeters: number,
  spatialIndex = new NodeSpatialIndex(nodes, candidateRadiusMeters)
): readonly CandidateMatch[] {
  if (!Number.isFinite(candidateRadiusMeters) || candidateRadiusMeters <= 0) {
    throw new Error("Candidate radius must be a positive finite number");
  }

  const identityKey = identityTagKey(stop.sourceFeedId);
  const stopName = normalizeName(stop.stopNameExpanded);
  return spatialIndex
    .nearby(stop.latitude, stop.longitude, candidateRadiusMeters)
    .map((node): CandidateMatch => {
      const distanceMeters = haversineDistanceMeters(
        stop.latitude,
        stop.longitude,
        node.latitude,
        node.longitude
      );
      const exactIdentity = node.tags[identityKey] === stop.stopId;
      const expandedNameEqual =
        stopName.length > 0 && normalizeName(node.tags.name ?? "") === stopName;
      const evidence: MatchEvidence[] = [];
      if (exactIdentity) {
        evidence.push({
          kind: "exact-identity",
          key: identityKey,
          value: stop.stopId
        });
      }
      if (expandedNameEqual) {
        evidence.push({ kind: "expanded-name", value: stop.stopNameExpanded });
      }
      evidence.push({ kind: "distance", meters: distanceMeters });
      return {
        node,
        distanceMeters,
        evidence,
        exactIdentity,
        expandedNameEqual
      };
    })
    .filter((candidate) => candidate.distanceMeters <= candidateRadiusMeters)
    .sort((left, right) => {
      if (left.exactIdentity !== right.exactIdentity) {
        return left.exactIdentity ? -1 : 1;
      }
      if (left.expandedNameEqual !== right.expandedNameEqual) {
        return left.expandedNameEqual ? -1 : 1;
      }
      if (left.distanceMeters !== right.distanceMeters) {
        return left.distanceMeters - right.distanceMeters;
      }
      return left.node.id - right.node.id;
    });
}

export function determineInitialMatch(
  stop: EligibleStop,
  nodes: readonly OsmNode[],
  candidateRadiusMeters: number,
  autoIdRadiusMeters: number,
  spatialIndex?: NodeSpatialIndex
): InitialMatch {
  if (
    !Number.isFinite(autoIdRadiusMeters) ||
    autoIdRadiusMeters <= 0 ||
    autoIdRadiusMeters > candidateRadiusMeters
  ) {
    throw new Error(
      "Auto-ID radius must be positive and no greater than candidate radius"
    );
  }
  const candidates = rankCandidates(
    stop,
    nodes,
    candidateRadiusMeters,
    spatialIndex
  );
  const exact = candidates.filter(
    (candidate) =>
      candidate.exactIdentity && candidate.distanceMeters <= autoIdRadiusMeters
  );
  if (exact.length === 1) {
    return { kind: "auto-matched", candidate: exact[0] };
  }
  if (candidates.length === 0) {
    return { kind: "no-candidates", candidates: [] };
  }
  return { kind: "review", candidates };
}

export function canShareSelectedNode(
  first: EligibleStop,
  second: EligibleStop
): boolean {
  return first.sourceFeedId !== second.sourceFeedId;
}

export function validateSelectedClaims(
  assignments: readonly {
    feature: Pick<EligibleStop, "sourceFeedId" | "stopId">;
    nodeId: number;
  }[]
): readonly string[] {
  const issues: string[] = [];
  const sourceClaims = new Map<string, number>();
  const nodeSources = new Map<number, Set<string>>();
  for (const assignment of assignments) {
    const existingNode = sourceClaims.get(assignment.feature.sourceFeedId);
    if (existingNode !== undefined && existingNode !== assignment.nodeId) {
      issues.push(
        `Source feed ${assignment.feature.sourceFeedId} is claimed by multiple OSM nodes`
      );
    }
    sourceClaims.set(assignment.feature.sourceFeedId, assignment.nodeId);

    const sourcesForNode =
      nodeSources.get(assignment.nodeId) ?? new Set<string>();
    if (sourcesForNode.has(assignment.feature.sourceFeedId)) {
      issues.push(
        `OSM node ${assignment.nodeId} cannot merge two features from ${assignment.feature.sourceFeedId}`
      );
    }
    sourcesForNode.add(assignment.feature.sourceFeedId);
    nodeSources.set(assignment.nodeId, sourcesForNode);
  }
  return issues;
}
