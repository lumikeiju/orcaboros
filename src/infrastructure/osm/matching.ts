import { EligibleStop } from "../../domain/gtfs";
import {
  determineInitialMatch,
  InitialMatch,
  NodeSpatialIndex
} from "../../domain/matching";
import { OsmNode } from "../../domain/osm";

export type MatchingProgress = {
  processed: number;
  total: number;
};

export function matchStops(
  stops: readonly EligibleStop[],
  nodes: readonly OsmNode[],
  candidateRadiusMeters: number,
  autoIdRadiusMeters: number,
  onProgress?: (progress: MatchingProgress) => void
): ReadonlyMap<string, InitialMatch> {
  const results = new Map<string, InitialMatch>();
  const spatialIndex = new NodeSpatialIndex(nodes, candidateRadiusMeters);
  stops.forEach((stop, index) => {
    results.set(
      stop.featureId,
      determineInitialMatch(
        stop,
        nodes,
        candidateRadiusMeters,
        autoIdRadiusMeters,
        spatialIndex
      )
    );
    onProgress?.({ processed: index + 1, total: stops.length });
  });
  return results;
}
