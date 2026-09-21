import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { CandidateMatch, InitialMatch } from "../domain/matching";
import { EligibleStop } from "../domain/gtfs";
import { elementKey, isOsmWay, OsmElement, OsmElementRef } from "../domain/osm";
import {
  FeatureReview,
  ReviewAction,
  selectedElementRef,
  TagResolution
} from "../domain/review";
import { identityTagKey } from "../domain/source-feed";

const REVIEW_PAGE_SIZE = 10;

type ReviewCategory = "new" | "removed" | "moved" | "exact";

type StopReviewItem = {
  kind: "stop";
  category: ReviewCategory;
  stop: EligibleStop;
  result: InitialMatch | undefined;
  review: FeatureReview | undefined;
};

type RemovedReviewItem = {
  kind: "removed";
  category: "removed";
  node: OsmElement;
  identityTags: readonly { key: string; value: string }[];
};

type ReviewQueueItem = StopReviewItem | RemovedReviewItem;

type ReviewFilters = Record<ReviewCategory, boolean>;

function reviewQueueItemFeatureId(item: ReviewQueueItem): string {
  return item.kind === "stop"
    ? item.stop.featureId
    : `removed-${isOsmWay(item.node) ? elementKey(item.node) : item.node.id}`;
}

function elementDisplayLabel(element: OsmElement): "Node" | "Way" {
  return isOsmWay(element) ? "Way" : "Node";
}

function elementRefFor(element: OsmElement): OsmElementRef {
  return {
    type: isOsmWay(element) ? "way" : "node",
    id: element.id
  };
}

function selectionAction(element: OsmElement): ReviewAction {
  return isOsmWay(element)
    ? { type: "select-element", element: elementRefFor(element) }
    : { type: "select-match", nodeId: element.id };
}

function isSelected(
  review: FeatureReview | undefined,
  element: OsmElement
): boolean {
  const selected =
    review === undefined ? undefined : selectedElementRef(review);
  return selected !== undefined && elementKey(selected) === elementKey(element);
}

type DiffHighlight = "add" | "remove" | "both" | "none";

type ReviewDiffRowProps = {
  gtfsLabel: string;
  gtfsValue: string;
  osmLabel: string;
  osmValue: string;
  highlight: DiffHighlight;
};

function ReviewDiffRow({
  gtfsLabel,
  gtfsValue,
  osmLabel,
  osmValue,
  highlight
}: ReviewDiffRowProps): ReactElement {
  const addHighlighted = highlight === "add" || highlight === "both";
  const removeHighlighted = highlight === "remove" || highlight === "both";
  return (
    <tr className={`review-diff-row is-${highlight}`}>
      <td
        className={`review-diff-cell review-diff-cell-add${
          addHighlighted ? " is-highlighted" : ""
        }`}
      >
        <div className="review-diff-cell-content">
          <span className="review-diff-field">{gtfsLabel}</span>
          <span className="review-diff-value">{gtfsValue}</span>
        </div>
      </td>
      <td
        className={`review-diff-cell review-diff-cell-remove${
          removeHighlighted ? " is-highlighted" : ""
        }`}
      >
        <div className="review-diff-cell-content">
          <span className="review-diff-field">{osmLabel}</span>
          <span className="review-diff-value">{osmValue}</span>
        </div>
      </td>
    </tr>
  );
}

type ReviewQueueProps = {
  stops: readonly EligibleStop[];
  matches: ReadonlyMap<string, InitialMatch>;
  reviews: ReadonlyMap<string, FeatureReview>;
  nodes?: readonly OsmElement[];
  validStopIds?: ReadonlyMap<string, ReadonlySet<string>>;
  exactMatchRadiusMeters?: number;
  onAction: (featureId: string, action: ReviewAction) => void;
  focusedFeatureId?: string;
  onFocusFeature: (featureId: string) => void;
};

export function ReviewQueue({
  stops,
  matches,
  reviews,
  nodes = [],
  validStopIds = new Map(),
  exactMatchRadiusMeters = Number.POSITIVE_INFINITY,
  onAction,
  focusedFeatureId,
  onFocusFeature
}: ReviewQueueProps): ReactElement {
  const [filters, setFilters] = useState<ReviewFilters>({
    new: true,
    removed: true,
    moved: true,
    exact: false
  });
  const [page, setPage] = useState(1);
  const focusedCardRef = useRef<HTMLLIElement>(null);

  const items = useMemo<readonly ReviewQueueItem[]>(() => {
    const stopItems = stops.map((stop): StopReviewItem => {
      const result = matches.get(stop.featureId);
      const exactCandidate = findExactIdentityCandidate(result);
      const category: ReviewCategory =
        exactCandidate === undefined
          ? "new"
          : exactCandidate.distanceMeters > exactMatchRadiusMeters
            ? "moved"
            : "exact";
      return {
        kind: "stop",
        category,
        stop,
        result,
        review: reviews.get(stop.featureId)
      };
    });
    const identityKeys = new Map(
      [...validStopIds.keys()].map((sourceFeedId) => [
        identityTagKey(sourceFeedId),
        sourceFeedId
      ])
    );
    const removedItems = nodes.flatMap((node): RemovedReviewItem[] => {
      const identityTags = Object.entries(node.tags)
        .filter(([key, value]) => {
          const sourceFeedId = identityKeys.get(key);
          return (
            sourceFeedId !== undefined &&
            !validStopIds.get(sourceFeedId)?.has(value)
          );
        })
        .map(([key, value]) => ({ key, value }));
      return identityTags.length > 0
        ? [{ kind: "removed", category: "removed", node, identityTags }]
        : [];
    });
    return [...stopItems, ...removedItems];
  }, [exactMatchRadiusMeters, matches, nodes, reviews, stops, validStopIds]);

  const categoryCounts = useMemo(() => {
    const counts: Record<ReviewCategory, number> = {
      new: 0,
      removed: 0,
      moved: 0,
      exact: 0
    };
    items.forEach((item) => {
      counts[item.category] += 1;
    });
    return counts;
  }, [items]);
  const visibleItems = items.filter((item) => filters[item.category]);
  const focusedVisibleIndex = visibleItems.findIndex(
    (item) => reviewQueueItemFeatureId(item) === focusedFeatureId
  );
  const pageCount = Math.max(
    1,
    Math.ceil(visibleItems.length / REVIEW_PAGE_SIZE)
  );
  const currentPage = Math.min(page, pageCount);
  const pageItems = visibleItems.slice(
    (currentPage - 1) * REVIEW_PAGE_SIZE,
    currentPage * REVIEW_PAGE_SIZE
  );
  const selectedItem =
    pageItems.find(
      (item) => reviewQueueItemFeatureId(item) === focusedFeatureId
    ) ?? pageItems[0];

  useEffect(() => {
    if (focusedFeatureId === undefined) {
      return;
    }
    const focusedItem = items.find(
      (item) => reviewQueueItemFeatureId(item) === focusedFeatureId
    );
    if (focusedItem !== undefined && !filters[focusedItem.category]) {
      setFilters((current) => ({
        ...current,
        [focusedItem.category]: true
      }));
    }
  }, [filters, focusedFeatureId, items]);

  useEffect(() => {
    const nextPage =
      focusedVisibleIndex >= 0
        ? Math.floor(focusedVisibleIndex / REVIEW_PAGE_SIZE) + 1
        : 1;
    setPage((current) => (current === nextPage ? current : nextPage));
  }, [filters, focusedVisibleIndex]);

  useEffect(() => {
    if (focusedFeatureId !== undefined) {
      focusedCardRef.current?.focus();
    }
  }, [currentPage, focusedFeatureId]);

  function toggleFilter(category: ReviewCategory): void {
    setFilters((current) => ({
      ...current,
      [category]: !current[category]
    }));
  }

  function handleCardClick(
    event: MouseEvent<HTMLLIElement>,
    featureId: string
  ): void {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      target.closest("button, input, label, select, textarea, summary, a") !==
        null
    ) {
      return;
    }
    event.currentTarget.focus();
    onFocusFeature(featureId);
  }

  function handleCardKeyDown(
    event: KeyboardEvent<HTMLLIElement>,
    featureId: string
  ): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onFocusFeature(featureId);
    }
  }

  function handleDecisionAction(featureId: string, action: ReviewAction): void {
    onAction(featureId, action);
    const currentIndex = visibleItems.findIndex(
      (item) => reviewQueueItemFeatureId(item) === featureId
    );
    const nextItem = visibleItems[currentIndex + 1];
    if (nextItem !== undefined) {
      onFocusFeature(reviewQueueItemFeatureId(nextItem));
    }
  }

  function renderStopCard(item: StopReviewItem): ReactElement {
    const { stop, result, review } = item;
    return (
      <li
        key={stop.featureId}
        className={`review-card${
          focusedFeatureId === stop.featureId ? " is-focused" : ""
        }`}
        role="button"
        tabIndex={0}
        ref={focusedFeatureId === stop.featureId ? focusedCardRef : undefined}
        aria-label={`Focus ${stop.stopNameExpanded} on the map`}
        aria-pressed={focusedFeatureId === stop.featureId}
        onClick={(event) => handleCardClick(event, stop.featureId)}
        onKeyDown={(event) => handleCardKeyDown(event, stop.featureId)}
      >
        <div className="review-card-heading">
          <div>
            <h3>{stop.stopNameExpanded}</h3>
            <p>
              {stop.sourceFeedId} / {stop.stopId} / {stop.locationKind}
            </p>
          </div>
          <div className="review-card-states">
            <span className={`category category-${item.category}`}>
              {item.category}
            </span>
            <span className={`state state-${review?.state ?? "unreviewed"}`}>
              {review?.state ?? "unreviewed"}
            </span>
          </div>
        </div>
        {result?.kind === "auto-matched" && (
          <fieldset>
            <legend>Automatic evidence</legend>
            <label className="choice">
              <input
                type="radio"
                name={`candidate-${stop.featureId}`}
                checked={isSelected(review, result.candidate.node)}
                onChange={() =>
                  onAction(
                    stop.featureId,
                    selectionAction(result.candidate.node)
                  )
                }
              />
              <span className="evidence">
                Exact identity match at{" "}
                {result.candidate.distanceMeters.toFixed(1)} m on OSM{" "}
                {isOsmWay(result.candidate.node) ? "way" : "node"}{" "}
                {result.candidate.node.id}.
              </span>
            </label>
          </fieldset>
        )}
        {result?.kind === "review" && result.candidates.length > 0 && (
          <fieldset>
            <legend>Candidate OSM elements</legend>
            {result.candidates.map((candidate) => (
              <label className="choice" key={elementKey(candidate.node)}>
                <input
                  type="radio"
                  name={`candidate-${stop.featureId}`}
                  checked={isSelected(review, candidate.node)}
                  onChange={() =>
                    onAction(stop.featureId, selectionAction(candidate.node))
                  }
                />
                <span>
                  OSM {isOsmWay(candidate.node) ? "way" : "node"}{" "}
                  {candidate.node.id}, {candidate.distanceMeters.toFixed(1)} m
                  {candidate.exactIdentity ? " - exact identity" : ""}
                  {candidate.expandedNameEqual ? " - expanded name" : ""}
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {review !== undefined && review.proposals.length > 0 && (
          <fieldset>
            <legend>Tag decisions</legend>
            {review.proposals.map((proposal) => (
              <div className="tag-decision" key={proposal.key}>
                <strong>{proposal.key}</strong>
                <span>
                  current: {proposal.currentValue ?? "(missing)"}; proposed:{" "}
                  {proposal.proposedValue ?? "(none)"}
                  {proposal.stale ? " - stale selected-source identity" : ""}
                </span>
                <div className="tag-options">
                  {(["accept-proposed", "keep-current", "remove"] as const).map(
                    (resolution: TagResolution) => (
                      <label className="choice" key={resolution}>
                        <input
                          type="radio"
                          name={`tag-${stop.featureId}-${proposal.key}`}
                          value={resolution}
                          checked={proposal.resolution === resolution}
                          disabled={
                            resolution === "accept-proposed" &&
                            proposal.proposedValue === undefined
                          }
                          onChange={() =>
                            onAction(stop.featureId, {
                              type: "set-tag-resolution",
                              key: proposal.key,
                              resolution
                            })
                          }
                        />
                        <span>{resolution}</span>
                      </label>
                    )
                  )}
                </div>
              </div>
            ))}
          </fieldset>
        )}
        <div className="button-row">
          <button
            type="button"
            onClick={() =>
              onAction(stop.featureId, {
                type: "select-create",
                latitude: stop.latitude,
                longitude: stop.longitude
              })
            }
          >
            Create separate node
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => onAction(stop.featureId, { type: "skip" })}
          >
            Skip feature
          </button>
        </div>
      </li>
    );
  }

  function renderRemovedCard(item: RemovedReviewItem): ReactElement {
    const featureId = reviewQueueItemFeatureId(item);
    const elementLabel = isOsmWay(item.node) ? "way" : "node";
    return (
      <li
        key={featureId}
        className={`review-card review-card-removed${
          focusedFeatureId === featureId ? " is-focused" : ""
        }`}
        role="button"
        tabIndex={0}
        ref={focusedFeatureId === featureId ? focusedCardRef : undefined}
        aria-label={`Focus OSM ${elementLabel} ${item.node.id} on the map`}
        aria-pressed={focusedFeatureId === featureId}
        onClick={(event) => handleCardClick(event, featureId)}
        onKeyDown={(event) => handleCardKeyDown(event, featureId)}
      >
        <div className="review-card-heading">
          <div>
            <h3>
              OSM {elementLabel} {item.node.id}
            </h3>
            <p>
              {item.node.latitude.toFixed(5)}, {item.node.longitude.toFixed(5)}
            </p>
          </div>
          <span className="category category-removed">removed</span>
        </div>
        <p>This OSM identity is not present in the imported GTFS data.</p>
        <ul>
          {item.identityTags.map((tag) => (
            <li key={tag.key}>
              {tag.key}: {tag.value}
            </li>
          ))}
        </ul>
      </li>
    );
  }

  function renderDetail(item: ReviewQueueItem): ReactElement {
    if (item.kind === "removed") {
      return (
        <article className="review-detail">
          <div className="review-detail-heading">
            <div>
              <p className="eyebrow">Stop comparison</p>
              <h3>
                {elementDisplayLabel(item.node)} {item.node.id}
              </h3>
            </div>
            <span className="category category-removed">removed</span>
          </div>
          <div className="review-diff">
            <div className="review-diff-legend" aria-label="Diff legend">
              <span className="review-diff-key review-diff-key-add">
                <span aria-hidden="true">+</span> Add or update from GTFS
              </span>
              <span className="review-diff-key review-diff-key-remove">
                <span aria-hidden="true">−</span> Remove or replace on OSM
              </span>
            </div>
            <table className="review-diff-columns">
              <caption className="visually-hidden">
                GTFS values on the left and OSM values on the right
              </caption>
              <thead>
                <tr>
                  <th scope="col">GTFS</th>
                  <th scope="col">OSM</th>
                </tr>
              </thead>
              <tbody>
                <ReviewDiffRow
                  gtfsLabel={elementDisplayLabel(item.node)}
                  gtfsValue="(not present)"
                  osmLabel={elementDisplayLabel(item.node)}
                  osmValue={String(item.node.id)}
                  highlight="remove"
                />
                <ReviewDiffRow
                  gtfsLabel="latitude"
                  gtfsValue="(not present)"
                  osmLabel="center latitude"
                  osmValue={item.node.latitude.toFixed(6)}
                  highlight="remove"
                />
                <ReviewDiffRow
                  gtfsLabel="longitude"
                  gtfsValue="(not present)"
                  osmLabel="center longitude"
                  osmValue={item.node.longitude.toFixed(6)}
                  highlight="remove"
                />
                {item.identityTags.map((tag) => (
                  <ReviewDiffRow
                    key={tag.key}
                    gtfsLabel={tag.key}
                    gtfsValue="(not present)"
                    osmLabel={tag.key}
                    osmValue={tag.value}
                    highlight="remove"
                  />
                ))}
              </tbody>
            </table>
          </div>
        </article>
      );
    }
    const { stop, result, review } = item;
    const candidate = getPrimaryCandidate(result);
    const gtfsIdentity = stop.stopId;
    const osmIdentity = candidate?.node.tags[stop.identityTag.key];
    const gtfsName = stop.stopNameExpanded;
    const osmName = candidate?.node.tags.name;
    const gtfsLatitude = stop.latitude.toFixed(6);
    const osmLatitude = candidate?.node.latitude.toFixed(6);
    const gtfsLongitude = stop.longitude.toFixed(6);
    const osmLongitude = candidate?.node.longitude.toFixed(6);
    const highlightComparedValues = (
      gtfsValue: string,
      osmValue: string | undefined
    ): DiffHighlight => {
      if (osmValue === undefined) {
        return "add";
      }
      return gtfsValue === osmValue ? "none" : "both";
    };
    return (
      <article className="review-detail">
        <div className="review-detail-heading">
          <div>
            <p className="eyebrow">Stop comparison</p>
            <h3>{stop.stopNameExpanded}</h3>
          </div>
          <span className={`state state-${review?.state ?? "unreviewed"}`}>
            {review?.state ?? "unreviewed"}
          </span>
        </div>
        <div className="review-diff">
          <div className="review-diff-legend" aria-label="Diff legend">
            <span className="review-diff-key review-diff-key-add">
              <span aria-hidden="true">+</span> Add or update from GTFS
            </span>
            <span className="review-diff-key review-diff-key-remove">
              <span aria-hidden="true">−</span> Remove or replace on OSM
            </span>
          </div>
          <table className="review-diff-columns">
            <caption className="visually-hidden">
              GTFS values on the left and OSM values on the right
            </caption>
            <thead>
              <tr>
                <th scope="col">GTFS</th>
                <th scope="col">OSM</th>
              </tr>
            </thead>
            <tbody>
              <ReviewDiffRow
                gtfsLabel="stop_id"
                gtfsValue={gtfsIdentity}
                osmLabel="identity"
                osmValue={osmIdentity ?? "(missing)"}
                highlight={highlightComparedValues(gtfsIdentity, osmIdentity)}
              />
              <ReviewDiffRow
                gtfsLabel="stop_name"
                gtfsValue={gtfsName}
                osmLabel="name"
                osmValue={osmName ?? "(missing)"}
                highlight={highlightComparedValues(gtfsName, osmName)}
              />
              <ReviewDiffRow
                gtfsLabel="stop_lat"
                gtfsValue={gtfsLatitude}
                osmLabel="latitude"
                osmValue={osmLatitude ?? "(missing)"}
                highlight={highlightComparedValues(gtfsLatitude, osmLatitude)}
              />
              <ReviewDiffRow
                gtfsLabel="stop_lon"
                gtfsValue={gtfsLongitude}
                osmLabel="longitude"
                osmValue={osmLongitude ?? "(missing)"}
                highlight={highlightComparedValues(gtfsLongitude, osmLongitude)}
              />
              <ReviewDiffRow
                gtfsLabel="(metadata)"
                gtfsValue="—"
                osmLabel="highway"
                osmValue={candidate?.node.tags.highway ?? "(missing)"}
                highlight="none"
              />
              <ReviewDiffRow
                gtfsLabel="(metadata)"
                gtfsValue="—"
                osmLabel="distance"
                osmValue={
                  candidate === undefined
                    ? "-"
                    : `${candidate.distanceMeters.toFixed(0)} m`
                }
                highlight="none"
              />
            </tbody>
          </table>
        </div>
      </article>
    );
  }

  function renderDecisionActions(item: StopReviewItem): ReactElement {
    const candidate = getPrimaryCandidate(item.result);
    return (
      <div className="review-decision-actions">
        {candidate !== undefined && (
          <button
            type="button"
            className="decision-accept"
            onClick={() =>
              handleDecisionAction(
                item.stop.featureId,
                selectionAction(candidate.node)
              )
            }
          >
            Accept match
          </button>
        )}
        <button
          type="button"
          className="decision-reject"
          onClick={() =>
            handleDecisionAction(item.stop.featureId, { type: "skip" })
          }
        >
          Reject
        </button>
        <button
          type="button"
          className="decision-modify"
          onClick={() =>
            handleDecisionAction(item.stop.featureId, {
              type: "select-create",
              latitude: item.stop.latitude,
              longitude: item.stop.longitude
            })
          }
        >
          Modify
        </button>
      </div>
    );
  }

  return (
    <div className="review-columns">
      <section
        className="panel review-queue-panel"
        aria-labelledby="review-heading"
      >
        <h2 id="review-heading">Review Queue ({items.length})</h2>
        <p>
          Every feature must be explicitly matched, created, or skipped before
          an export can be enabled. Name and distance evidence never
          auto-selects.
        </p>
        <fieldset className="review-filters">
          <legend>Show results</legend>
          {(["new", "removed", "moved", "exact"] as const).map((category) => (
            <button
              type="button"
              className={`review-filter-toggle${
                filters[category] ? " is-on" : ""
              }`}
              role="switch"
              aria-checked={filters[category]}
              aria-label={`Show ${category} results`}
              key={category}
              onClick={() => toggleFilter(category)}
            >
              <span className="review-toggle-track" aria-hidden="true">
                <span className="review-toggle-thumb" />
              </span>
              <span>
                {category} ({categoryCounts[category]})
              </span>
            </button>
          ))}
        </fieldset>
        <p className="review-summary" role="status">
          {visibleItems.length === 0
            ? "No results match the selected filters."
            : `Showing ${(currentPage - 1) * REVIEW_PAGE_SIZE + 1}-${Math.min(
                currentPage * REVIEW_PAGE_SIZE,
                visibleItems.length
              )} of ${visibleItems.length} results`}
        </p>
        <ol className="review-list">
          {pageItems.map((item) =>
            item.kind === "removed"
              ? renderRemovedCard(item)
              : renderStopCard(item)
          )}
        </ol>
        {pageCount > 1 && (
          <nav className="review-pagination" aria-label="Review result pages">
            <button
              type="button"
              className="secondary"
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </button>
            <span aria-live="polite">
              Page {currentPage} of {pageCount}
            </span>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                setPage((current) => Math.min(pageCount, current + 1))
              }
              disabled={currentPage === pageCount}
            >
              Next
            </button>
          </nav>
        )}
      </section>
      <section
        className="review-comparison"
        aria-labelledby="comparison-heading"
      >
        {selectedItem?.kind === "stop" && (
          <section
            className="review-decision"
            aria-labelledby="decision-heading"
          >
            <h2 id="decision-heading">Decision</h2>
            {renderDecisionActions(selectedItem)}
          </section>
        )}
        <h2 id="comparison-heading">Comparison</h2>
        {selectedItem !== undefined && renderDetail(selectedItem)}
      </section>
      <div className="review-column-empty" aria-hidden="true" />
    </div>
  );
}

function getPrimaryCandidate(
  result: InitialMatch | undefined
): CandidateMatch | undefined {
  if (result?.kind === "auto-matched") {
    return result.candidate;
  }
  if (result?.kind === "review") {
    return result.candidates[0];
  }
  return undefined;
}

function findExactIdentityCandidate(
  result: InitialMatch | undefined
): CandidateMatch | undefined {
  if (result?.kind === "auto-matched") {
    return result.candidate.exactIdentity ? result.candidate : undefined;
  }
  if (result?.kind === "review") {
    return result.candidates.find((candidate) => candidate.exactIdentity);
  }
  return undefined;
}
