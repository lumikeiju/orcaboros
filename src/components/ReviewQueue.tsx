import { type ReactElement } from "react";
import { InitialMatch } from "../domain/matching";
import { EligibleStop } from "../domain/gtfs";
import { FeatureReview, ReviewAction, TagResolution } from "../domain/review";

type ReviewQueueProps = {
  stops: readonly EligibleStop[];
  matches: ReadonlyMap<string, InitialMatch>;
  reviews: ReadonlyMap<string, FeatureReview>;
  onAction: (featureId: string, action: ReviewAction) => void;
};

export function ReviewQueue({
  stops,
  matches,
  reviews,
  onAction
}: ReviewQueueProps): ReactElement {
  return (
    <section className="panel" aria-labelledby="review-heading">
      <h2 id="review-heading">3. Review matches</h2>
      <p>
        Every feature must be explicitly matched, created, or skipped before an
        export can be enabled. Name and distance evidence never auto-selects.
      </p>
      <ol className="review-list">
        {stops.map((stop) => {
          const result = matches.get(stop.featureId);
          const review = reviews.get(stop.featureId);
          return (
            <li key={stop.featureId} className="review-card">
              <div className="review-card-heading">
                <div>
                  <h3>{stop.stopNameExpanded}</h3>
                  <p>
                    {stop.sourceFeedId} / {stop.stopId} / {stop.locationKind}
                  </p>
                </div>
                <span
                  className={`state state-${review?.state ?? "unreviewed"}`}
                >
                  {review?.state ?? "unreviewed"}
                </span>
              </div>
              {result?.kind === "auto-matched" && (
                <fieldset>
                  <legend>Automatic evidence</legend>
                  <label className="choice">
                    <input
                      type="radio"
                      name={`candidate-${stop.featureId}`}
                      checked={
                        review?.selectedNodeId === result.candidate.node.id
                      }
                      onChange={() =>
                        onAction(stop.featureId, {
                          type: "select-match",
                          nodeId: result.candidate.node.id
                        })
                      }
                    />
                    <span className="evidence">
                      Exact identity match at{" "}
                      {result.candidate.distanceMeters.toFixed(1)} m on OSM node{" "}
                      {result.candidate.node.id}.
                    </span>
                  </label>
                </fieldset>
              )}
              {result?.kind === "review" && result.candidates.length > 0 && (
                <fieldset>
                  <legend>Candidate nodes</legend>
                  {result.candidates.map((candidate) => (
                    <label className="choice" key={candidate.node.id}>
                      <input
                        type="radio"
                        name={`candidate-${stop.featureId}`}
                        checked={review?.selectedNodeId === candidate.node.id}
                        onChange={() =>
                          onAction(stop.featureId, {
                            type: "select-match",
                            nodeId: candidate.node.id
                          })
                        }
                      />
                      <span>
                        OSM node {candidate.node.id},{" "}
                        {candidate.distanceMeters.toFixed(1)} m
                        {candidate.exactIdentity ? " — exact identity" : ""}
                        {candidate.expandedNameEqual ? " — expanded name" : ""}
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
                        current: {proposal.currentValue ?? "(missing)"};
                        proposed: {proposal.proposedValue ?? "(none)"}
                        {proposal.stale
                          ? " — stale selected-source identity"
                          : ""}
                      </span>
                      <div className="tag-options">
                        {(
                          ["accept-proposed", "keep-current", "remove"] as const
                        ).map((resolution: TagResolution) => (
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
                        ))}
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
        })}
      </ol>
    </section>
  );
}
