import { EligibleStop } from "./gtfs";
import { OsmElement, OsmTag, OsmTagSet } from "./osm";
import { FeatureReviewState } from "./review";
import type { GeometryTarget } from "./source-feed";

export type DraftCreate = {
  feature: EligibleStop;
  state: Extract<FeatureReviewState, "create-selected">;
  latitude: number;
  longitude: number;
  tags: OsmTagSet;
};

export type DraftModify = {
  node: OsmElement;
  coordinates: { latitude: number; longitude: number };
  featureIds: readonly string[];
  requiredIdentityTags: readonly OsmTag[];
  tags: OsmTagSet;
};

export type ChangeDraft = {
  sessionId: string;
  snapshotId: string;
  creates: readonly DraftCreate[];
  modifications: readonly DraftModify[];
};

export function coordinatesForGeometryTarget(
  geometryTarget: GeometryTarget,
  feature: Pick<EligibleStop, "latitude" | "longitude">,
  node: Pick<OsmElement, "latitude" | "longitude"> & { type?: "node" | "way" }
): { latitude: number; longitude: number } {
  return geometryTarget === "gtfs" && node.type !== "way"
    ? { latitude: feature.latitude, longitude: feature.longitude }
    : { latitude: node.latitude, longitude: node.longitude };
}
