import { EligibleStop } from "./gtfs";
import { OsmNode, OsmTagSet, recordToTagArray, tagArrayToRecord } from "./osm";
import { identityTagKey } from "./source-feed";

export type FeatureReviewState =
  | "unreviewed"
  | "auto-matched"
  | "match-selected"
  | "create-selected"
  | "skipped";

export type TagResolution = "accept-proposed" | "keep-current" | "remove";

export type TagProposal = {
  key: string;
  proposedValue: string | undefined;
  currentValue: string | undefined;
  defaultResolution: TagResolution;
  resolution: TagResolution;
  stale: boolean;
};

export type FeatureReview = {
  featureId: string;
  state: FeatureReviewState;
  selectedNodeId: number | undefined;
  createCoordinates: { latitude: number; longitude: number } | undefined;
  proposals: readonly TagProposal[];
};

export type ReviewAction =
  | { type: "select-match"; nodeId: number }
  | { type: "select-create"; latitude: number; longitude: number }
  | { type: "skip" }
  | { type: "set-tag-resolution"; key: string; resolution: TagResolution };

export function defaultTagResolution(
  currentValue: string | undefined,
  proposedValue: string | undefined
): TagResolution {
  if (proposedValue === undefined) {
    return "keep-current";
  }
  if (currentValue === undefined) {
    return "accept-proposed";
  }
  return currentValue === proposedValue ? "keep-current" : "keep-current";
}

export function buildTagProposals(
  node: OsmNode | undefined,
  proposedTags: OsmTagSet,
  staleKeys: readonly string[] = []
): readonly TagProposal[] {
  const current = node?.tags ?? {};
  const keys = new Set([
    ...Object.keys(current),
    ...Object.keys(proposedTags),
    ...staleKeys
  ]);
  return [...keys]
    .sort((left, right) => left.localeCompare(right))
    .map((key) => {
      const proposedValue = proposedTags[key];
      const currentValue = current[key];
      const stale = staleKeys.includes(key) && proposedValue === undefined;
      const defaultResolution = defaultTagResolution(
        currentValue,
        proposedValue
      );
      return {
        key,
        proposedValue,
        currentValue,
        defaultResolution: stale ? "keep-current" : defaultResolution,
        resolution: stale ? "keep-current" : defaultResolution,
        stale
      };
    });
}

export function applyReviewAction(
  review: FeatureReview,
  action: ReviewAction
): FeatureReview {
  switch (action.type) {
    case "select-match":
      return {
        ...review,
        state: "match-selected",
        selectedNodeId: action.nodeId,
        createCoordinates: undefined
      };
    case "select-create":
      return {
        ...review,
        state: "create-selected",
        selectedNodeId: undefined,
        createCoordinates: {
          latitude: action.latitude,
          longitude: action.longitude
        }
      };
    case "skip":
      return {
        ...review,
        state: "skipped",
        selectedNodeId: undefined,
        createCoordinates: undefined
      };
    case "set-tag-resolution":
      return {
        ...review,
        proposals: review.proposals.map((proposal) =>
          proposal.key === action.key
            ? { ...proposal, resolution: action.resolution }
            : proposal
        )
      };
  }
}

export function computePostChangeTags(
  currentTags: OsmTagSet,
  proposals: readonly TagProposal[]
): OsmTagSet {
  const result: Record<string, string> = { ...currentTags };
  for (const proposal of proposals) {
    switch (proposal.resolution) {
      case "accept-proposed":
        if (proposal.proposedValue === undefined) {
          throw new Error(
            `Cannot accept a missing proposed value for ${proposal.key}`
          );
        }
        result[proposal.key] = proposal.proposedValue;
        break;
      case "remove":
        delete result[proposal.key];
        break;
      case "keep-current":
        break;
    }
  }
  return result;
}

export function staleIdentityKeys(
  node: OsmNode,
  selectedSourceFeedIds: readonly string[],
  validStopIds: ReadonlyMap<string, ReadonlySet<string>>
): readonly string[] {
  const selected = new Set(selectedSourceFeedIds);
  return Object.keys(node.tags).filter((key) => {
    const match = /^gtfs:stop_id:([A-Z0-9]+(?:-[A-Z0-9]+)*)$/u.exec(key);
    if (match === null || !selected.has(match[1])) {
      return false;
    }
    const validIds = validStopIds.get(match[1]);
    return validIds !== undefined && !validIds.has(node.tags[key]);
  });
}

export type DraftFeatureValidation = {
  featureId: string;
  state: FeatureReviewState;
  requiredIdentityKey: string;
  requiredIdentityValue: string;
  selectedNodeId: number | undefined;
};

export function validateReviewCompletion(
  reviews: readonly DraftFeatureValidation[],
  postChangeTagsByNode: ReadonlyMap<number, OsmTagSet>
): readonly string[] {
  const issues: string[] = [];
  for (const review of reviews) {
    if (review.state === "unreviewed") {
      issues.push(`${review.featureId} is still unreviewed`);
      continue;
    }
    if (review.state === "match-selected" || review.state === "auto-matched") {
      if (review.selectedNodeId === undefined) {
        issues.push(`${review.featureId} has no selected OSM node`);
        continue;
      }
      const tags = postChangeTagsByNode.get(review.selectedNodeId);
      if (
        tags === undefined ||
        tags[review.requiredIdentityKey] !== review.requiredIdentityValue
      ) {
        issues.push(`${review.featureId} has no required identity tag`);
      }
    }
    if (
      review.state === "create-selected" &&
      review.selectedNodeId !== undefined
    ) {
      issues.push(`${review.featureId} has contradictory create selection`);
    }
  }
  return issues;
}

export function normalizeReviewTags(tags: OsmTagSet): OsmTagSet {
  return tagArrayToRecord(recordToTagArray(tags));
}

export function isIdentityTagForFeature(
  key: string,
  stop: Pick<EligibleStop, "sourceFeedId">
): boolean {
  return key === identityTagKey(stop.sourceFeedId);
}
