import { EligibleStop } from "./gtfs";
import {
  OsmElement,
  OsmElementRef,
  OsmTagSet,
  elementKey,
  isOsmWay,
  osmElementRef,
  recordToTagArray,
  tagArrayToRecord
} from "./osm";
import { identityTagKey } from "./source-feed";
import { normalizeName } from "./street-name";

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
  selectedElement?: OsmElementRef;
  createCoordinates: { latitude: number; longitude: number } | undefined;
  proposals: readonly TagProposal[];
};

export type ReviewAction =
  | { type: "select-match"; nodeId: number }
  | { type: "select-element"; element: OsmElementRef }
  | { type: "select-create"; latitude: number; longitude: number }
  | { type: "skip" }
  | { type: "set-tag-resolution"; key: string; resolution: TagResolution };

function defaultTagResolutionForKey(
  key: string,
  currentValue: string | undefined,
  proposedValue: string | undefined
): TagResolution {
  if (proposedValue === undefined) {
    return "keep-current";
  }
  if (currentValue === undefined) {
    return "accept-proposed";
  }
  if (
    key === "name" &&
    normalizeName(currentValue) === normalizeName(proposedValue)
  ) {
    return "accept-proposed";
  }
  return currentValue === proposedValue ? "keep-current" : "keep-current";
}

export function defaultTagResolution(
  currentValue: string | undefined,
  proposedValue: string | undefined
): TagResolution {
  return defaultTagResolutionForKey("", currentValue, proposedValue);
}

export function buildTagProposals(
  node: OsmElement | undefined,
  proposedTags: OsmTagSet,
  staleKeys: readonly string[] = [],
  removeKeys: readonly string[] = []
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
      const remove = removeKeys.includes(key) && proposedValue === undefined;
      const defaultResolution = defaultTagResolutionForKey(
        key,
        currentValue,
        proposedValue
      );
      return {
        key,
        proposedValue,
        currentValue,
        defaultResolution: remove
          ? "remove"
          : stale
            ? "keep-current"
            : defaultResolution,
        resolution: remove
          ? "remove"
          : stale
            ? "keep-current"
            : defaultResolution,
        stale
      };
    });
}

export function refreshTagProposals(
  previous: readonly TagProposal[],
  node: OsmElement | undefined,
  proposedTags: OsmTagSet,
  staleKeys: readonly string[] = [],
  removeKeys: readonly string[] = [],
  forceAcceptKeys: readonly string[] = []
): readonly TagProposal[] {
  const previousByKey = new Map(
    previous.map((proposal) => [proposal.key, proposal])
  );
  return buildTagProposals(node, proposedTags, staleKeys, removeKeys).map(
    (proposal) => {
      if (
        forceAcceptKeys.includes(proposal.key) &&
        proposal.proposedValue !== undefined
      ) {
        return { ...proposal, resolution: "accept-proposed" };
      }
      const prior = previousByKey.get(proposal.key);
      if (prior === undefined || prior.resolution === prior.defaultResolution) {
        return proposal;
      }
      return { ...proposal, resolution: prior.resolution };
    }
  );
}

export function applyReviewAction(
  review: FeatureReview,
  action: ReviewAction
): FeatureReview {
  switch (action.type) {
    case "select-match": {
      return {
        ...review,
        state: "match-selected",
        selectedNodeId: action.nodeId,
        selectedElement: { type: "node", id: action.nodeId },
        createCoordinates: undefined
      };
    }
    case "select-element":
      return {
        ...review,
        state: "match-selected",
        selectedNodeId:
          action.element.type === "node" ? action.element.id : undefined,
        selectedElement: action.element,
        createCoordinates: undefined
      };
    case "select-create":
      return {
        ...review,
        state: "create-selected",
        selectedNodeId: undefined,
        selectedElement: undefined,
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
        selectedElement: undefined,
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

export function removeTags(
  tags: OsmTagSet,
  keys: readonly string[]
): OsmTagSet {
  const result: Record<string, string> = { ...tags };
  keys.forEach((key) => delete result[key]);
  return result;
}

export function staleIdentityKeys(
  node: OsmElement,
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

export function legacyIdentityKeys(
  node: OsmElement,
  stop: Pick<EligibleStop, "stopId" | "identityTag">
): readonly string[] {
  const legacyValue = node.tags["gtfs:stop_id"];
  const sourceIdentityValue = node.tags[stop.identityTag.key];
  return legacyValue === stop.stopId &&
    (sourceIdentityValue === undefined || sourceIdentityValue === stop.stopId)
    ? ["gtfs:stop_id"]
    : [];
}

export type DraftFeatureValidation = {
  featureId: string;
  state: FeatureReviewState;
  selectedNodeId: number | undefined;
  selectedElement?: OsmElementRef;
};

export function selectedElementRef(
  review: Pick<FeatureReview, "selectedNodeId" | "selectedElement">
): OsmElementRef | undefined {
  return (
    review.selectedElement ??
    (review.selectedNodeId === undefined
      ? undefined
      : { type: "node", id: review.selectedNodeId })
  );
}

function selectedRef(
  review: Pick<DraftFeatureValidation, "selectedNodeId" | "selectedElement">
): OsmElementRef | undefined {
  return selectedElementRef(review);
}

export function validateReviewCompletion(
  reviews: readonly DraftFeatureValidation[]
): readonly string[] {
  const issues: string[] = [];
  for (const review of reviews) {
    if (review.state === "unreviewed") {
      issues.push(`${review.featureId} is still unreviewed`);
      continue;
    }
    if (review.state === "match-selected" || review.state === "auto-matched") {
      const selected = selectedRef(review);
      if (selected === undefined) {
        issues.push(`${review.featureId} has no selected OSM element`);
        continue;
      }
    }
    if (
      review.state === "create-selected" &&
      selectedRef(review) !== undefined
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

export type ConflationProgress = {
  resolved: number;
  total: number;
};

/**
 * Returns the feature ID of the first feature that still requires a review
 * decision, or `undefined` when every feature has been decided.
 *
 * The queue order matches the review queue: GTFS stops in feed order, then
 * OSM-only nodes whose identity tags are absent from the imported data.
 */
export function firstUndecidedFeatureId({
  stops,
  nodes,
  reviews,
  validStopIds
}: {
  stops: readonly EligibleStop[];
  nodes: readonly OsmElement[];
  reviews: ReadonlyMap<string, FeatureReview>;
  validStopIds: ReadonlyMap<string, ReadonlySet<string>>;
}): string | undefined {
  const undecidedStop = stops.find(
    (stop) =>
      reviews.get(stop.featureId)?.state === undefined ||
      reviews.get(stop.featureId)?.state === "unreviewed"
  );
  if (undecidedStop !== undefined) {
    return undecidedStop.featureId;
  }
  const identityKeys = new Map(
    [...validStopIds.keys()].map((sourceFeedId) => [
      identityTagKey(sourceFeedId),
      sourceFeedId
    ])
  );
  const removedNode = nodes.find((node) =>
    Object.entries(node.tags).some(([key, value]) => {
      const sourceFeedId = identityKeys.get(key);
      return (
        sourceFeedId !== undefined &&
        !validStopIds.get(sourceFeedId)?.has(value)
      );
    })
  );
  return removedNode === undefined
    ? undefined
    : `removed-${
        isOsmWay(removedNode)
          ? elementKey(osmElementRef(removedNode))
          : removedNode.id
      }`;
}

/**
 * Computes the conflation progress ring values.
 *
 * Resolved counts GTFS features that are auto-matched or have an explicit
 * review decision. Total counts every feature that requires a decision:
 * OSM-only features (removed), GTFS-only features (new), and matched
 * features (exact or moved).
 */
export function computeConflationProgress({
  stops,
  nodes,
  reviews,
  validStopIds
}: {
  stops: readonly EligibleStop[];
  nodes: readonly OsmElement[];
  reviews: ReadonlyMap<string, FeatureReview>;
  validStopIds: ReadonlyMap<string, ReadonlySet<string>>;
}): ConflationProgress {
  const resolved = stops.filter((stop) => {
    const state = reviews.get(stop.featureId)?.state;
    return state !== undefined && state !== "unreviewed";
  }).length;
  const identityKeys = new Map(
    [...validStopIds.keys()].map((sourceFeedId) => [
      identityTagKey(sourceFeedId),
      sourceFeedId
    ])
  );
  const onlyInOsmCount = nodes.filter((node) =>
    Object.entries(node.tags).some(([key, value]) => {
      const sourceFeedId = identityKeys.get(key);
      return (
        sourceFeedId !== undefined &&
        !validStopIds.get(sourceFeedId)?.has(value)
      );
    })
  ).length;
  return {
    resolved,
    total: onlyInOsmCount + stops.length
  };
}
