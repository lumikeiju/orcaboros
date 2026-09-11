import { EligibleStop } from "./gtfs";
import { OsmNode, OsmTag, OsmTagSet } from "./osm";
import { FeatureReviewState } from "./review";

export type DraftCreate = {
  feature: EligibleStop;
  state: Extract<FeatureReviewState, "create-selected">;
  latitude: number;
  longitude: number;
  tags: OsmTagSet;
};

export type DraftModify = {
  node: OsmNode;
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
