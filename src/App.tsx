import { type ReactElement, useEffect, useMemo, useRef, useState } from "react";
import { SourcePicker, SelectedArchive } from "./components/SourcePicker";
import { ProfileEditor } from "./components/ProfileEditor";
import { ReviewQueue } from "./components/ReviewQueue";
import { MapView } from "./components/MapView";
import { fingerprintProfile, getPugetSoundProfile } from "./profiles";
import { MappingProfile } from "./domain/profile";
import { EligibleStop, FeedImportResult } from "./domain/gtfs";
import {
  FeatureReview,
  applyReviewAction,
  buildTagProposals,
  computePostChangeTags,
  staleIdentityKeys
} from "./domain/review";
import { InitialMatch, validateSelectedClaims } from "./domain/matching";
import { OsmNode } from "./domain/osm";
import { ChangeDraft, DraftCreate, DraftModify } from "./domain/change";
import {
  ImportWorkerHandle,
  startArchiveImport
} from "./features/import/worker-client";
import {
  buildOverpassRequests,
  identityKeysForSourceFeeds,
  retrieveOverpassNodes,
  workingBoundsForStops
} from "./infrastructure/osm";
import { matchStopsInWorker } from "./features/matching/worker-client";
import { mapStopToOsmTags } from "./infrastructure/gtfs";
import { serializeOsmChange } from "./infrastructure/osm/change-export";
import { identityTagKey } from "./domain/source-feed";
import {
  IndexedDbSessionRepository,
  MemorySessionRepository,
  SessionRepository,
  buildStagedSession,
  stageAndActivateSession
} from "./storage";

export function App(): ReactElement {
  const [profile, setProfile] = useState<MappingProfile>(
    getPugetSoundProfile()
  );
  const [archives, setArchives] = useState<readonly SelectedArchive[]>([]);
  const [selectionErrors, setSelectionErrors] = useState<readonly string[]>([]);
  const [stops, setStops] = useState<readonly EligibleStop[]>([]);
  const [feedSummaries, setFeedSummaries] = useState<
    readonly FeedImportResult[]
  >([]);
  const [validStopIds, setValidStopIds] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(new Map());
  const [nodes, setNodes] = useState<readonly OsmNode[]>([]);
  const [matches, setMatches] = useState<ReadonlyMap<string, InitialMatch>>(
    new Map()
  );
  const [reviews, setReviews] = useState<ReadonlyMap<string, FeatureReview>>(
    new Map()
  );
  const [endpoint, setEndpoint] = useState("");
  const [styleUrl, setStyleUrl] = useState("");
  const [status, setStatus] = useState("Select local feeds to begin.");
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [importActive, setImportActive] = useState(false);
  const activeImportHandle = useRef<ImportWorkerHandle | null>(null);
  const [osmRequestActive, setOsmRequestActive] = useState(false);
  const osmAbortController = useRef<AbortController | null>(null);
  const repository = useMemo<SessionRepository>(
    () =>
      typeof indexedDB === "undefined"
        ? new MemorySessionRepository()
        : new IndexedDbSessionRepository(),
    []
  );

  const enabledDefinitions = useMemo(
    () => profile.sourceFeeds.filter((source) => source.enabled),
    [profile.sourceFeeds]
  );

  useEffect(() => {
    let active = true;
    void repository
      .getActiveSession()
      .then((session) => {
        if (!active || session === undefined) {
          return;
        }
        setProfile(session.profile);
        const restoredStops = session.sourceFeeds.flatMap(
          (source) => source.eligibleStops
        );
        setStops(restoredStops);
        setFeedSummaries(
          session.sourceFeeds.map((source) => ({
            sourceFeedId: source.sourceFeedId,
            sourceFeedName: source.sourceFeedName,
            eligibleStops: source.eligibleStops,
            validStopIds: new Set(source.validStopIds),
            diagnostics: source.diagnostics,
            counts: source.counts
          }))
        );
        setValidStopIds(
          new Map(
            session.sourceFeeds.map((source) => [
              source.sourceFeedId,
              new Set(source.validStopIds)
            ])
          )
        );
        if (session.osmSnapshot !== undefined) {
          setNodes(session.osmSnapshot.nodes);
        }
        if (session.reviews !== undefined) {
          setReviews(
            new Map(session.reviews.map((review) => [review.featureId, review]))
          );
        }
        setStatus(
          `Restored ${restoredStops.length} eligible stops from the active session.`
        );
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "The active session could not be loaded."
          );
        }
      });
    return () => {
      active = false;
    };
  }, [repository]);

  async function importSelectedArchives(): Promise<void> {
    if (archives.length === 0 || selectionErrors.length > 0) {
      setError("Select at least one enabled ZIP archive before importing.");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const imported = [];
      for (const archive of archives) {
        const handle = startArchiveImport(
          archive.file,
          enabledDefinitions,
          (stage, rowsRead) => {
            setStatus(`${archive.sourceFeedId}: ${stage} (${rowsRead} rows)`);
          }
        );
        activeImportHandle.current = handle;
        setImportActive(true);
        imported.push(await handle.promise);
        activeImportHandle.current = null;
        setImportActive(false);
      }
      const stagedSession = await buildStagedSession(
        crypto.randomUUID(),
        profile,
        imported
      );
      await stageAndActivateSession(repository, stagedSession);
      const nextStops = imported.flatMap((item) => item.result.eligibleStops);
      setStops(nextStops);
      setFeedSummaries(imported.map((item) => item.result));
      setValidStopIds(
        new Map(
          imported.map((item) => [item.sourceFeedId, item.result.validStopIds])
        )
      );
      setNodes([]);
      setMatches(new Map());
      setReviews(new Map());
      setStatus(
        `Imported ${nextStops.length} eligible stops from ${imported.length} source feed${
          imported.length === 1 ? "" : "s"
        }.`
      );
    } catch (caught: unknown) {
      setError(
        caught instanceof Error ? caught.message : "The GTFS import failed."
      );
      setStatus("The previous active session remains unchanged.");
    } finally {
      activeImportHandle.current = null;
      setImportActive(false);
      setLoading(false);
    }
  }

  async function retrieveCandidates(): Promise<void> {
    if (stops.length === 0) {
      setError("Import eligible stops before retrieving OSM candidates.");
      return;
    }
    setLoading(true);
    setError(undefined);
    const controller = new AbortController();
    osmAbortController.current = controller;
    setOsmRequestActive(true);
    try {
      const bounds = workingBoundsForStops(
        stops,
        profile.candidateRadiusMeters
      );
      const identityKeys = identityKeysForSourceFeeds([
        ...new Set(stops.map((stop) => stop.sourceFeedId))
      ]);
      const requests = buildOverpassRequests(bounds, identityKeys);
      const nodesById = new Map<number, OsmNode>();
      for (const request of requests) {
        const requestNodes = await retrieveOverpassNodes(
          endpoint,
          request.query,
          controller.signal
        );
        requestNodes.forEach((node) => nodesById.set(node.id, node));
      }
      const retrieved = [...nodesById.values()];
      const activeSession = await repository.getActiveSession();
      if (activeSession === undefined) {
        throw new Error("The active GTFS session is no longer available");
      }
      const snapshotId = crypto.randomUUID();
      const snapshotTimestamp = new Date().toISOString();
      await repository.putActiveSession({
        ...activeSession,
        osmSnapshot: {
          snapshotId,
          timestamp: snapshotTimestamp,
          bounds,
          nodes: retrieved
        },
        reviews: undefined,
        draft: undefined,
        manifest: {
          ...activeSession.manifest,
          osmSnapshotId: snapshotId,
          osmSnapshotTimestamp: snapshotTimestamp,
          osmSnapshotBounds: bounds,
          reviewStateVersion: activeSession.manifest.reviewStateVersion + 1,
          draftVersion: activeSession.manifest.draftVersion + 1
        }
      });
      setNodes(retrieved);
      const initial = await matchStopsInWorker(
        stops,
        retrieved,
        profile.candidateRadiusMeters,
        profile.autoIdRadiusMeters,
        (processed, total) =>
          setStatus(`Matching OSM candidates (${processed}/${total})`)
      );
      setMatches(initial);
      setReviews(
        new Map(
          stops.map((stop) => {
            const result = initial.get(stop.featureId);
            const node =
              result?.kind === "auto-matched"
                ? result.candidate.node
                : undefined;
            const mappedTags = mapStopToOsmTags(profile, stop);
            const staleKeys =
              node === undefined
                ? []
                : staleIdentityKeys(
                    node,
                    [
                      ...new Set(
                        stops.map((candidate) => candidate.sourceFeedId)
                      )
                    ],
                    validStopIds
                  );
            return [
              stop.featureId,
              {
                featureId: stop.featureId,
                state:
                  result?.kind === "auto-matched"
                    ? "auto-matched"
                    : "unreviewed",
                selectedNodeId: node?.id,
                createCoordinates: undefined,
                proposals: buildTagProposals(node, mappedTags, staleKeys)
              } satisfies FeatureReview
            ];
          })
        )
      );
      setStatus(
        `Retrieved ${retrieved.length} OSM candidate nodes for review.`
      );
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The OSM candidate request failed."
      );
    } finally {
      setLoading(false);
      osmAbortController.current = null;
      setOsmRequestActive(false);
    }
  }

  function applyAction(
    featureId: string,
    action: Parameters<typeof applyReviewAction>[1]
  ): void {
    const current = reviews.get(featureId);
    if (current === undefined) {
      return;
    }
    const stop = stops.find((candidate) => candidate.featureId === featureId);
    let updated = applyReviewAction(current, action);
    if (
      stop !== undefined &&
      (action.type === "select-match" || action.type === "select-create")
    ) {
      const node =
        action.type === "select-match"
          ? nodes.find((candidate) => candidate.id === action.nodeId)
          : undefined;
      const staleKeys =
        node === undefined
          ? []
          : staleIdentityKeys(
              node,
              [...new Set(stops.map((candidate) => candidate.sourceFeedId))],
              validStopIds
            );
      updated = {
        ...updated,
        proposals: buildTagProposals(
          node,
          mapStopToOsmTags(profile, stop),
          staleKeys
        )
      };
    }
    const nextReviews = new Map(reviews).set(featureId, updated);
    setReviews(nextReviews);
    void persistReviews(nextReviews);
  }

  async function persistReviews(
    nextReviews: ReadonlyMap<string, FeatureReview>
  ): Promise<void> {
    try {
      const activeSession = await repository.getActiveSession();
      if (
        activeSession === undefined ||
        activeSession.osmSnapshot === undefined
      ) {
        return;
      }
      await repository.putActiveSession({
        ...activeSession,
        reviews: [...nextReviews.values()],
        draft: undefined
      });
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The review decision could not be saved."
      );
    }
  }

  function createDraft(): ChangeDraft {
    const incomplete = stops.filter(
      (stop) =>
        reviews.get(stop.featureId)?.state === undefined ||
        reviews.get(stop.featureId)?.state === "unreviewed"
    );
    if (incomplete.length > 0) {
      throw new Error(`${incomplete.length} feature(s) are still unreviewed`);
    }
    const claimIssues = validateSelectedClaims(
      stops.flatMap((stop) => {
        const review = reviews.get(stop.featureId);
        return review !== undefined &&
          (review.state === "match-selected" ||
            review.state === "auto-matched") &&
          review.selectedNodeId !== undefined
          ? [{ feature: stop, nodeId: review.selectedNodeId }]
          : [];
      })
    );
    if (claimIssues.length > 0) {
      throw new Error(claimIssues.join("; "));
    }
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const creates: DraftCreate[] = [];
    const modifications = new Map<number, DraftModify>();
    for (const stop of stops) {
      const review = reviews.get(stop.featureId);
      if (review === undefined || review.state === "skipped") {
        continue;
      }
      if (review.state === "create-selected") {
        if (review.createCoordinates === undefined) {
          throw new Error(`${stop.featureId} has no create coordinates`);
        }
        creates.push({
          feature: stop,
          state: "create-selected",
          latitude: review.createCoordinates.latitude,
          longitude: review.createCoordinates.longitude,
          tags: computePostChangeTags({}, review.proposals)
        });
        continue;
      }
      if (review.selectedNodeId === undefined) {
        throw new Error(`${stop.featureId} has no selected OSM node`);
      }
      const node = nodeById.get(review.selectedNodeId);
      if (node === undefined) {
        throw new Error(
          `${stop.featureId} refers to a node outside the current snapshot`
        );
      }
      const existing = modifications.get(node.id);
      const tags = computePostChangeTags(
        existing?.tags ?? node.tags,
        review.proposals
      );
      if (tags[identityTagKey(stop.sourceFeedId)] !== stop.stopId) {
        throw new Error(
          `${stop.featureId} does not have its required identity tag`
        );
      }
      modifications.set(node.id, {
        node,
        featureIds: [...(existing?.featureIds ?? []), stop.featureId],
        requiredIdentityTags: [
          ...(existing?.requiredIdentityTags ?? []),
          stop.identityTag
        ],
        tags
      });
    }
    return {
      sessionId: "browser-session",
      snapshotId: "current-snapshot",
      creates,
      modifications: [...modifications.values()]
    };
  }

  async function exportDraft(): Promise<void> {
    try {
      const draft = createDraft();
      const activeSession = await repository.getActiveSession();
      if (activeSession === undefined) {
        throw new Error("The active GTFS session is no longer available");
      }
      await repository.putActiveSession({
        ...activeSession,
        reviews: [...reviews.values()],
        draft
      });
      const xml = serializeOsmChange(draft);
      const blob = new Blob([xml], { type: "application/xml" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "orcaboros.osc";
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus(
        "Downloaded the reviewed OSM Change file. Open it in JOSM for final review."
      );
      setError(undefined);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The OSM Change export is invalid."
      );
    }
  }

  async function resetSession(): Promise<void> {
    try {
      activeImportHandle.current?.cancel();
      await repository.resetActiveSession();
      setArchives([]);
      setSelectionErrors([]);
      setStops([]);
      setFeedSummaries([]);
      setValidStopIds(new Map());
      setNodes([]);
      setMatches(new Map());
      setReviews(new Map());
      setEndpoint("");
      setStyleUrl("");
      osmAbortController.current?.abort();
      osmAbortController.current = null;
      setOsmRequestActive(false);
      setError(undefined);
      setStatus("Session reset. Select local feeds to begin.");
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The active session could not be reset."
      );
    }
  }

  async function handleProfileChange(
    nextProfile: MappingProfile
  ): Promise<void> {
    setProfile(nextProfile);
    setNodes([]);
    setMatches(new Map());
    setReviews(new Map());
    try {
      const activeSession = await repository.getActiveSession();
      if (activeSession !== undefined) {
        const profileFingerprint = await fingerprintProfile(nextProfile);
        await repository.putActiveSession({
          ...activeSession,
          profile: nextProfile,
          osmSnapshot: undefined,
          reviews: undefined,
          draft: undefined,
          manifest: {
            ...activeSession.manifest,
            mappingProfileSchemaVersion: nextProfile.schemaVersion,
            mappingProfileFingerprint: profileFingerprint,
            osmSnapshotId: undefined,
            osmSnapshotTimestamp: undefined,
            osmSnapshotBounds: undefined,
            reviewStateVersion: activeSession.manifest.reviewStateVersion + 1,
            draftVersion: activeSession.manifest.draftVersion + 1
          }
        });
      }
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The profile change could not invalidate the current snapshot."
      );
    }
  }

  const exportBlocked =
    nodes.length === 0 ||
    stops.some((stop) => {
      const state = reviews.get(stop.featureId)?.state;
      return (
        state !== "auto-matched" &&
        state !== "match-selected" &&
        state !== "create-selected" &&
        state !== "skipped"
      );
    });

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">Browser-first GTFS / OSM review</p>
        <h1>Orcaboros</h1>
        <p>
          A conservative workflow for reviewing Puget Sound transit stop
          identities before producing an OSM Change file.
        </p>
      </header>
      <ProfileEditor
        profile={profile}
        onChange={(nextProfile) => void handleProfileChange(nextProfile)}
        onReset={() => void handleProfileChange(getPugetSoundProfile())}
      />
      <SourcePicker
        definitions={enabledDefinitions}
        selected={archives}
        onSelected={(next, errors) => {
          setArchives(next);
          setSelectionErrors(errors);
          setFeedSummaries([]);
          setError(errors.length > 0 ? errors.join("; ") : undefined);
        }}
      />
      {selectionErrors.length > 0 && (
        <div className="panel error-panel" role="alert">
          {selectionErrors.join("; ")}
        </div>
      )}
      <section className="panel" aria-labelledby="import-heading">
        <h2 id="import-heading">2. Import stop records</h2>
        <p role="status" aria-live="polite">
          {status}
        </p>
        <div className="button-row">
          <button
            type="button"
            onClick={() =>
              importActive
                ? activeImportHandle.current?.cancel()
                : void importSelectedArchives()
            }
            disabled={loading && !importActive}
          >
            {importActive
              ? "Cancel import"
              : loading
                ? "Working…"
                : "Import selected feeds"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void resetSession()}
            disabled={loading}
          >
            Reset current session
          </button>
        </div>
        {error !== undefined && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {feedSummaries.length > 0 && (
          <div className="diagnostics" aria-label="GTFS import diagnostics">
            {feedSummaries.map((summary) => (
              <div key={summary.sourceFeedId}>
                <strong>{summary.sourceFeedId}</strong>:{" "}
                {summary.counts.eligibleRows} eligible,{" "}
                {summary.counts.skippedRows} skipped (
                {summary.counts.unsupportedLocationRows} unsupported location
                rows).
                {summary.diagnostics.length > 0 && (
                  <ul>
                    {summary.diagnostics.slice(0, 5).map((diagnostic) => (
                      <li key={`${diagnostic.rowNumber}-${diagnostic.reason}`}>
                        row {diagnostic.rowNumber}: {diagnostic.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      {stops.length > 0 && (
        <section className="panel" aria-labelledby="osm-heading">
          <h2 id="osm-heading">Retrieve OSM candidates</h2>
          <p>
            The endpoint is used only for this browser session and is not
            stored. Requests are node-only and bounded by the candidate radius.
          </p>
          <label>
            HTTPS Overpass-compatible endpoint
            <input
              type="password"
              autoComplete="off"
              value={endpoint}
              onChange={(event) => setEndpoint(event.target.value)}
              placeholder="https://your-overpass.example/api/interpreter"
            />
          </label>
          <label>
            Optional session-only MapLibre style URL
            <input
              type="url"
              autoComplete="off"
              value={styleUrl}
              onChange={(event) => setStyleUrl(event.target.value)}
              placeholder="Leave blank for OpenFreeMap Liberty"
            />
          </label>
          <button
            type="button"
            onClick={() => void retrieveCandidates()}
            disabled={loading}
          >
            Retrieve candidates
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => osmAbortController.current?.abort()}
            disabled={!osmRequestActive}
          >
            Cancel OSM request
          </button>
        </section>
      )}
      {stops.length > 0 && (
        <>
          <ReviewQueue
            stops={stops}
            matches={matches}
            reviews={reviews}
            onAction={applyAction}
          />
          <MapView
            nodes={nodes}
            stops={stops}
            styleUrl={styleUrl.length > 0 ? styleUrl : undefined}
            selectedNodeIds={[...reviews.values()]
              .map((review) => review.selectedNodeId)
              .filter((nodeId): nodeId is number => nodeId !== undefined)}
          />
          <section className="panel" aria-labelledby="export-heading">
            <h2 id="export-heading">4. Export reviewed changes</h2>
            <p>
              Download is blocked until every eligible feature has an explicit
              decision and each selected node has a valid post-change tag set.
            </p>
            <button
              type="button"
              onClick={() => void exportDraft()}
              disabled={exportBlocked}
            >
              Download OSM Change for JOSM
            </button>
          </section>
        </>
      )}
    </main>
  );
}

export default App;
