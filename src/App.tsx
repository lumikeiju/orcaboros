import {
  type CSSProperties,
  type ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { SourcePicker, SelectedArchive } from "./components/SourcePicker";
import { ProgressIndicator } from "./components/ProgressIndicator";
import { ProfileEditor } from "./components/ProfileEditor";
import { ReviewQueue } from "./components/ReviewQueue";
import { MapView } from "./components/MapView";
import { ThemeToggle, type Theme } from "./components/ThemeToggle";
import { ResizeHandle } from "./components/ResizeHandle";
import {
  OsmRequestResult,
  type OsmRequestResultState
} from "./components/OsmRequestResult";
import {
  createCustomProfileForFeedIds,
  fingerprintProfile,
  getDefaultProfile,
  getProfileForFeedIds
} from "./profiles";
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
import {
  ChangeDraft,
  coordinatesForGeometryTarget,
  DraftCreate,
  DraftModify
} from "./domain/change";
import {
  ImportWorkerHandle,
  startArchiveImport
} from "./features/import/worker-client";
import {
  buildOverpassRequests,
  identityKeysForSourceFeeds,
  OverpassRequestError,
  retrieveOverpassNodes,
  workingBoundsForStops
} from "./infrastructure/osm";
import { matchStopsInWorker } from "./features/matching/worker-client";
import { mapStopToOsmTags } from "./infrastructure/gtfs";
import {
  createProgressThrottleState,
  shouldPublishProgress
} from "./infrastructure/browser/progress";
import { serializeOsmChange } from "./infrastructure/osm/change-export";
import {
  CONSOLIDATED_SOURCE_FEED_ID,
  DEFAULT_GEOMETRY_TARGET,
  identityTagKey,
  normalizeSourceFeedId,
  STOCK_SOURCE_FEED_DEFINITIONS
} from "./domain/source-feed";
import {
  IndexedDbSessionRepository,
  MemorySessionRepository,
  SessionRepository,
  buildStagedSession,
  stageAndActivateSession
} from "./storage";
import packageMetadata from "../package.json";

type ImportProgressState = {
  sourceFeedId: string;
  archiveIndex: number;
  totalArchives: number;
  stage: string;
  rowsRead: number;
  bytesRead: number;
  totalBytes: number;
};

type OsmProgressState = {
  phase: "query" | "matching";
  processed: number;
  total: number;
};

type WorkflowStepId = "upload" | "profile" | "retrieve" | "review" | "export";

const MIN_RAIL_WIDTH = 18;
const MAX_RAIL_WIDTH = 36;
const MIN_REVIEW_HEIGHT = 20;
const MAX_REVIEW_HEIGHT = 55;

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"] as const;
  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded =
    unitIndex === 0 || value >= 10 ? Math.round(value) : value.toFixed(1);
  return `${rounded} ${units[unitIndex]}`;
}

export function App(): ReactElement {
  const [theme, setTheme] = useState<Theme>("dark");
  const [profile, setProfile] = useState<MappingProfile>(getDefaultProfile());
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
  const [retrievalComplete, setRetrievalComplete] = useState(false);
  const [matches, setMatches] = useState<ReadonlyMap<string, InitialMatch>>(
    new Map()
  );
  const [reviews, setReviews] = useState<ReadonlyMap<string, FeatureReview>>(
    new Map()
  );
  const [focusedFeatureId, setFocusedFeatureId] = useState<string>();
  const [openWorkflowStep, setOpenWorkflowStep] = useState<
    WorkflowStepId | undefined
  >("upload");
  const [railWidth, setRailWidth] = useState(25);
  const [reviewHeight, setReviewHeight] = useState(33);
  const [endpoint, setEndpoint] = useState("");
  const [styleUrl, setStyleUrl] = useState("");
  const [status, setStatus] = useState("Select local feeds to begin.");
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [importActive, setImportActive] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportProgressState>();
  const activeImportHandle = useRef<ImportWorkerHandle | null>(null);
  const importProgressThrottle = useRef(createProgressThrottleState());
  const [osmRequestActive, setOsmRequestActive] = useState(false);
  const [osmProgress, setOsmProgress] = useState<OsmProgressState>();
  const [osmRequestResult, setOsmRequestResult] =
    useState<OsmRequestResultState>();
  const osmAbortController = useRef<AbortController | null>(null);
  const matchingProgressThrottle = useRef(createProgressThrottleState());
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
  const availableFields = useMemo(
    () => [...new Set(feedSummaries.flatMap((summary) => summary.fields))],
    [feedSummaries]
  );
  const exampleRowCounts = useMemo(
    () =>
      new Map(
        feedSummaries.map((summary) => [
          summary.sourceFeedId,
          summary.counts.totalRows
        ])
      ),
    [feedSummaries]
  );

  useEffect(() => {
    let active = true;
    void repository
      .getActiveSession()
      .then((session) => {
        if (!active || session === undefined) {
          return;
        }
        setProfile({
          ...session.profile,
          sourceFeeds: session.profile.sourceFeeds.map((sourceFeed) => ({
            ...sourceFeed,
            geometryTarget: sourceFeed.geometryTarget ?? DEFAULT_GEOMETRY_TARGET
          }))
        });
        const restoredStops = session.sourceFeeds.flatMap(
          (source) => source.eligibleStops
        );
        setStops(restoredStops);
        setFeedSummaries(
          session.sourceFeeds.map((source) => ({
            sourceFeedId: source.sourceFeedId,
            sourceFeedName: source.sourceFeedName,
            fields: source.fields ?? [
              ...new Set(
                source.eligibleStops.flatMap((stop) =>
                  Object.keys(stop.rawFields)
                )
              )
            ],
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
        setRetrievalComplete(
          session.osmSnapshot !== undefined && session.reviews !== undefined
        );
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
    const importableArchives = archives.filter((archive) =>
      enabledDefinitions.some(
        (definition) =>
          normalizeSourceFeedId(definition.id) ===
          normalizeSourceFeedId(archive.sourceFeedId)
      )
    );
    if (importableArchives.length === 0) {
      setError("Select at least one supported ZIP archive before importing.");
      return;
    }
    const skippedArchiveCount = archives.length - importableArchives.length;
    setLoading(true);
    setError(undefined);
    setOsmRequestResult(undefined);
    setImportActive(true);
    setStatus(
      `Starting GTFS import for ${importableArchives.length} source feed${
        importableArchives.length === 1 ? "" : "s"
      }.`
    );
    try {
      const imported = [];
      for (const [archiveIndex, archive] of importableArchives.entries()) {
        importProgressThrottle.current = createProgressThrottleState();
        setStatus(
          `${archive.sourceFeedId}: fingerprinting (0 B of ${formatBytes(
            archive.file.size
          )})`
        );
        setImportProgress({
          sourceFeedId: archive.sourceFeedId,
          archiveIndex: archiveIndex + 1,
          totalArchives: importableArchives.length,
          stage: "fingerprinting",
          rowsRead: 0,
          bytesRead: 0,
          totalBytes: archive.file.size
        });
        const handle = startArchiveImport(
          archive.file,
          enabledDefinitions,
          (stage, rowsRead, bytesRead, totalBytes) => {
            if (
              !shouldPublishProgress(
                importProgressThrottle.current,
                stage,
                stage === "complete"
              )
            ) {
              return;
            }
            const progressTotalBytes = totalBytes ?? archive.file.size;
            setStatus(
              stage === "fingerprinting"
                ? `${archive.sourceFeedId}: fingerprinting (${formatBytes(
                    bytesRead
                  )} of ${formatBytes(progressTotalBytes)})`
                : `${archive.sourceFeedId}: ${stage} (${rowsRead} rows)`
            );
            setImportProgress({
              sourceFeedId: archive.sourceFeedId,
              archiveIndex: archiveIndex + 1,
              totalArchives: importableArchives.length,
              stage,
              rowsRead,
              bytesRead,
              totalBytes: progressTotalBytes
            });
          },
          archive.sourceFeedId
        );
        activeImportHandle.current = handle;
        imported.push(await handle.promise);
        activeImportHandle.current = null;
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
      setRetrievalComplete(false);
      setMatches(new Map());
      setReviews(new Map());
      setFocusedFeatureId(undefined);
      setStatus(
        `Imported ${nextStops.length} eligible stops from ${imported.length} source feed${
          imported.length === 1 ? "" : "s"
        }.${
          skippedArchiveCount > 0
            ? ` Skipped ${skippedArchiveCount} unsupported feed${
                skippedArchiveCount === 1 ? "" : "s"
              }.`
            : ""
        }`
      );
    } catch (caught: unknown) {
      if (
        (caught instanceof DOMException && caught.name === "AbortError") ||
        (caught instanceof Error && caught.name === "AbortError")
      ) {
        setError(undefined);
        setStatus(
          "Import cancelled. The previous active session remains unchanged."
        );
        return;
      }
      setError(
        caught instanceof Error ? caught.message : "The GTFS import failed."
      );
      setStatus("The previous active session remains unchanged.");
    } finally {
      activeImportHandle.current = null;
      setImportActive(false);
      setImportProgress(undefined);
      setLoading(false);
    }
  }

  function handleArchiveSelection(
    nextArchives: readonly SelectedArchive[],
    errors: readonly string[]
  ): void {
    setRetrievalComplete(false);
    setArchives(nextArchives);
    setSelectionErrors(errors);
    setFeedSummaries([]);
    setOsmRequestResult(undefined);
    setError(errors.length > 0 ? errors.join("; ") : undefined);
    if (errors.length === 0 && nextArchives.length > 0) {
      const selectableFeedIds = nextArchives
        .map((archive) => archive.sourceFeedId)
        .filter(
          (sourceFeedId) =>
            normalizeSourceFeedId(sourceFeedId) !== CONSOLIDATED_SOURCE_FEED_ID
        );
      if (selectableFeedIds.length > 0) {
        try {
          const matchedProfile =
            getProfileForFeedIds(selectableFeedIds) ??
            createCustomProfileForFeedIds(selectableFeedIds);
          void handleProfileChange(matchedProfile);
        } catch (caught: unknown) {
          const message =
            caught instanceof Error
              ? caught.message
              : "The feed ID cannot be used for a mapping profile.";
          setSelectionErrors([message]);
          setError(message);
        }
      }
    }
  }

  async function retrieveCandidates(): Promise<void> {
    if (stops.length === 0) {
      setError("Import eligible stops before retrieving OSM candidates.");
      return;
    }
    setRetrievalComplete(false);
    setLoading(true);
    setError(undefined);
    setOsmRequestResult(undefined);
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
      setOsmProgress({ phase: "query", processed: 0, total: requests.length });
      const nodesById = new Map<number, OsmNode>();
      for (const [requestIndex, request] of requests.entries()) {
        setStatus(
          `Retrieving OSM candidates (${requestIndex + 1}/${requests.length})`
        );
        const requestNodes = await retrieveOverpassNodes(
          endpoint,
          request.query,
          controller.signal
        );
        requestNodes.forEach((node) => nodesById.set(node.id, node));
        setOsmProgress({
          phase: "query",
          processed: requestIndex + 1,
          total: requests.length
        });
      }
      const retrieved = [...nodesById.values()];
      setOsmRequestResult(
        retrieved.length === 0
          ? { kind: "empty", requestCount: requests.length }
          : {
              kind: "success",
              nodeCount: retrieved.length,
              requestCount: requests.length
            }
      );
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
      setOsmProgress({ phase: "matching", processed: 0, total: stops.length });
      matchingProgressThrottle.current = createProgressThrottleState();
      const initial = await matchStopsInWorker(
        stops,
        retrieved,
        profile.candidateRadiusMeters,
        profile.autoIdRadiusMeters,
        (processed, total) => {
          if (
            !shouldPublishProgress(
              matchingProgressThrottle.current,
              "matching",
              processed === total
            )
          ) {
            return;
          }
          setStatus(`Matching OSM candidates (${processed}/${total})`);
          setOsmProgress({ phase: "matching", processed, total });
        }
      );
      setMatches(initial);
      const initialReviews = new Map(
        stops.map((stop) => {
          const result = initial.get(stop.featureId);
          const node =
            result?.kind === "auto-matched" ? result.candidate.node : undefined;
          const mappedTags = mapStopToOsmTags(profile, stop);
          const staleKeys =
            node === undefined
              ? []
              : staleIdentityKeys(
                  node,
                  [
                    ...new Set(stops.map((candidate) => candidate.sourceFeedId))
                  ],
                  validStopIds
                );
          return [
            stop.featureId,
            {
              featureId: stop.featureId,
              state:
                result?.kind === "auto-matched" ? "auto-matched" : "unreviewed",
              selectedNodeId: node?.id,
              createCoordinates: undefined,
              proposals: buildTagProposals(node, mappedTags, staleKeys)
            } satisfies FeatureReview
          ];
        })
      );
      setReviews(initialReviews);
      await persistReviews(initialReviews);
      setRetrievalComplete(true);
      setStatus(
        retrieved.length === 0
          ? "Overpass returned no OSM candidate nodes."
          : `Retrieved ${retrieved.length} OSM candidate nodes for review.`
      );
    } catch (caught: unknown) {
      const message =
        caught instanceof Error
          ? caught.message
          : "The OSM candidate request failed.";
      setOsmRequestResult(
        caught instanceof OverpassRequestError &&
          caught.category === "cancelled"
          ? { kind: "cancelled" }
          : { kind: "failed", message }
      );
      setStatus(
        caught instanceof OverpassRequestError &&
          caught.category === "cancelled"
          ? "Overpass request cancelled."
          : "Overpass request failed."
      );
    } finally {
      setLoading(false);
      osmAbortController.current = null;
      setOsmRequestActive(false);
      setOsmProgress(undefined);
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
      const sourceFeed = profile.sourceFeeds.find(
        (candidate) =>
          normalizeSourceFeedId(candidate.id) ===
          normalizeSourceFeedId(stop.sourceFeedId)
      );
      const coordinates = coordinatesForGeometryTarget(
        sourceFeed?.geometryTarget ?? "osm",
        stop,
        node
      );
      const existing = modifications.get(node.id);
      if (
        existing !== undefined &&
        (existing.coordinates.latitude !== coordinates.latitude ||
          existing.coordinates.longitude !== coordinates.longitude)
      ) {
        throw new Error(
          `${node.id} has conflicting geometry targets for selected features`
        );
      }
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
        coordinates,
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
      setRetrievalComplete(false);
      setMatches(new Map());
      setReviews(new Map());
      setFocusedFeatureId(undefined);
      setImportProgress(undefined);
      setEndpoint("");
      setStyleUrl("");
      osmAbortController.current?.abort();
      osmAbortController.current = null;
      setOsmRequestActive(false);
      setOsmProgress(undefined);
      setOsmRequestResult(undefined);
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
    setRetrievalComplete(false);
    setOsmRequestResult(undefined);
    setMatches(new Map());
    setReviews(new Map());
    setFocusedFeatureId(undefined);
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
    !retrievalComplete ||
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

  const currentWorkflowStep =
    openWorkflowStep === undefined ? "upload" : openWorkflowStep;
  const workflowSteps: readonly {
    id: WorkflowStepId;
    number: string;
    label: string;
    detail: string;
  }[] = [
    {
      id: "upload",
      number: "1",
      label: "Upload",
      detail: "Load your GTFS feed(s)"
    },
    {
      id: "profile",
      number: "2",
      label: "Profile",
      detail: "Configure matching and region"
    },
    {
      id: "retrieve",
      number: "3",
      label: "Retrieve",
      detail: "Get OSM data for comparison"
    },
    {
      id: "review",
      number: "4",
      label: "Review",
      detail: "Inspect discrepancies"
    },
    {
      id: "export",
      number: "5",
      label: "Export",
      detail: "Save results and contribute"
    }
  ] as const;

  const decidedReviewCount = [...reviews.values()].filter(
    (review) => review.state !== "unreviewed"
  ).length;

  function renderWorkflowContent(stepId: WorkflowStepId): ReactElement {
    switch (stepId) {
      case "upload":
        return (
          <div
            id="upload-step-panel"
            className="workflow-step-panel workflow-step-content"
            role="region"
            aria-labelledby="workflow-step-upload"
          >
            <SourcePicker
              definitions={STOCK_SOURCE_FEED_DEFINITIONS}
              selected={archives}
              allowUnknown
              onSelected={handleArchiveSelection}
            />
            {selectionErrors.length > 0 && (
              <div className="panel error-panel" role="alert">
                {selectionErrors.join("; ")}
              </div>
            )}
            <section
              className="panel"
              aria-labelledby="import-heading"
              aria-busy={importActive}
            >
              <h2 id="import-heading">Process GTFS data</h2>
              <p role="status" aria-live="polite">
                {status}
              </p>
              {importActive && importProgress !== undefined && (
                <ProgressIndicator
                  label={`GTFS import: ${importProgress.sourceFeedId}`}
                  detail={
                    importProgress.stage === "fingerprinting"
                      ? `Feed ${importProgress.archiveIndex} of ${importProgress.totalArchives} - fingerprinting - ${formatBytes(importProgress.bytesRead)} of ${formatBytes(importProgress.totalBytes)}`
                      : `Feed ${importProgress.archiveIndex} of ${importProgress.totalArchives} - ${importProgress.stage.replace(/-/gu, " ")} - ${importProgress.rowsRead.toLocaleString()} rows`
                  }
                  value={
                    importProgress.stage === "fingerprinting" &&
                    importProgress.totalBytes > 0
                      ? importProgress.bytesRead
                      : undefined
                  }
                  max={
                    importProgress.stage === "fingerprinting" &&
                    importProgress.totalBytes > 0
                      ? importProgress.totalBytes
                      : undefined
                  }
                />
              )}
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
                      : "Process selected feeds"}
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
                <div
                  className="diagnostics"
                  aria-label="GTFS import diagnostics"
                >
                  {feedSummaries.map((summary) => (
                    <div key={summary.sourceFeedId}>
                      <strong>{summary.sourceFeedId}</strong>:{" "}
                      {summary.counts.eligibleRows} eligible,{" "}
                      {summary.counts.skippedRows} skipped (
                      {summary.counts.unsupportedLocationRows} unsupported
                      location rows).
                      {summary.diagnostics.length > 0 && (
                        <ul>
                          {summary.diagnostics.slice(0, 5).map((diagnostic) => (
                            <li
                              key={`${diagnostic.rowNumber}-${diagnostic.reason}`}
                            >
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
          </div>
        );
      case "profile":
        return (
          <div
            id="profile-step-panel"
            className="workflow-step-panel workflow-step-content"
            role="region"
            aria-labelledby="workflow-step-profile"
          >
            <ProfileEditor
              profile={profile}
              availableFields={availableFields}
              availableFieldsByFeed={
                new Map(
                  feedSummaries.map((summary) => [
                    summary.sourceFeedId,
                    summary.fields
                  ])
                )
              }
              uploadedFeedIds={
                feedSummaries.length > 0
                  ? feedSummaries.map((summary) => summary.sourceFeedId)
                  : archives.map((archive) => archive.sourceFeedId)
              }
              exampleStops={stops}
              exampleRowCounts={exampleRowCounts}
              onChange={(nextProfile) => void handleProfileChange(nextProfile)}
              onReset={() => void handleProfileChange(getDefaultProfile())}
            />
          </div>
        );
      case "retrieve":
        return (
          <section
            id="retrieve-step-panel"
            className="workflow-step-panel workflow-step-content panel"
            role="region"
            aria-labelledby="workflow-step-retrieve"
            aria-busy={osmRequestActive}
          >
            <h2 id="osm-heading">3. Retrieve OSM candidates</h2>
            {stops.length === 0 ? (
              <p className="workflow-step-hint">
                Import eligible stops first. This step will retrieve nearby OSM
                candidates for comparison.
              </p>
            ) : (
              <>
                <p>
                  The endpoint is used only for this browser session and is not
                  stored. Requests are node-only and bounded by the candidate
                  radius.
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
                <label className="style-url-label">
                  Optional session-only MapLibre style URL
                  <input
                    type="url"
                    autoComplete="off"
                    value={styleUrl}
                    onChange={(event) => setStyleUrl(event.target.value)}
                    placeholder="Leave blank for Fiord dark / Positron light"
                  />
                </label>
                <button
                  type="button"
                  onClick={() => void retrieveCandidates()}
                  disabled={loading}
                >
                  Retrieve Candidates
                </button>
                {osmProgress !== undefined && (
                  <ProgressIndicator
                    label={
                      osmProgress.phase === "query"
                        ? "Overpass query"
                        : "Matching OSM candidates"
                    }
                    detail={
                      osmProgress.phase === "query"
                        ? `Query ${osmProgress.processed} of ${osmProgress.total}`
                        : `Matched ${osmProgress.processed} of ${osmProgress.total}`
                    }
                    value={osmProgress.processed}
                    max={osmProgress.total}
                  />
                )}
                {osmRequestResult !== undefined && (
                  <OsmRequestResult result={osmRequestResult} />
                )}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => osmAbortController.current?.abort()}
                  disabled={!osmRequestActive}
                >
                  Cancel OSM Request
                </button>
              </>
            )}
          </section>
        );
      case "review":
        return (
          <section
            id="review-step-panel"
            className="workflow-step-panel workflow-step-content panel"
            role="region"
            aria-labelledby="workflow-step-review"
          >
            <h2 id="workflow-sidebar-review-heading">
              4. Review discrepancies
            </h2>
            {stops.length === 0 ? (
              <p className="workflow-step-hint">
                Import a feed and retrieve OSM candidates to build the review
                queue.
              </p>
            ) : !retrievalComplete ? (
              <p className="workflow-step-hint">
                Retrieve OSM candidates before reviewing discrepancies.
              </p>
            ) : (
              <>
                <p>
                  <strong>{decidedReviewCount.toLocaleString()}</strong> of{" "}
                  {stops.length.toLocaleString()} decisions recorded.
                </p>
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    document
                      .getElementById("review-step")
                      ?.scrollIntoView({ behavior: "smooth", block: "start" })
                  }
                >
                  Open review queue
                </button>
              </>
            )}
          </section>
        );
      case "export":
        return (
          <section
            id="export-step-panel"
            className="workflow-step-panel workflow-step-content panel"
            role="region"
            aria-labelledby="workflow-step-export"
          >
            <h2 id="export-heading">5. Export reviewed changes</h2>
            {stops.length === 0 ? (
              <p className="workflow-step-hint">
                Complete import, retrieval, and review before exporting.
              </p>
            ) : (
              <>
                <p>
                  Download is blocked until every eligible feature has an
                  explicit decision and each selected node has a valid
                  post-change tag set.
                </p>
                <button
                  type="button"
                  onClick={() => void exportDraft()}
                  disabled={exportBlocked}
                >
                  Download OSM Change File
                </button>
              </>
            )}
          </section>
        );
    }
  }

  const layoutStyle = {
    "--layout-rail-width": `${railWidth}vw`,
    "--layout-review-height": `${reviewHeight}vh`
  } as CSSProperties;

  return (
    <main className="app-shell" style={layoutStyle}>
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Orcaboros</h1>
            <p>GTFS → OSM</p>
          </div>
        </div>
        <div className="hero-copy">
          <p className="eyebrow">Keeping GTFS and OSM in harmony</p>
          <p>Sync GTFS feed data with OpenStreetMap data</p>
        </div>
        <div className="header-actions">
          <span className="app-version">v{packageMetadata.version}</span>
          <a
            className="github-link"
            href="https://github.com/lumikeiju/orcaboros"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <ThemeToggle theme={theme} onThemeChange={setTheme} />
        </div>
      </header>
      <div className="app-body">
        <aside className="workflow-sidebar" aria-label="Review workflow">
          <nav className="workflow-nav" aria-label="Workflow steps">
            {workflowSteps.map((step) => {
              const isOpen = openWorkflowStep === step.id;
              const panelId = `${step.id}-step-panel`;
              return (
                <section
                  className={`workflow-step${isOpen ? " is-open" : ""}`}
                  key={step.id}
                >
                  <button
                    id={`workflow-step-${step.id}`}
                    className={`workflow-step-link${
                      currentWorkflowStep === step.id ? " is-active" : ""
                    }`}
                    type="button"
                    aria-label={`${step.number} ${step.label} ${step.detail}`}
                    aria-current={
                      currentWorkflowStep === step.id ? "step" : undefined
                    }
                    aria-expanded={isOpen}
                    aria-controls={panelId}
                    onClick={() =>
                      setOpenWorkflowStep((current) =>
                        current === step.id ? undefined : step.id
                      )
                    }
                  >
                    <span className="workflow-step-number">{step.number}</span>
                    <span>
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </span>
                    <span className="workflow-step-chevron" aria-hidden="true">
                      {isOpen ? "−" : "+"}
                    </span>
                  </button>
                  {isOpen && renderWorkflowContent(step.id)}
                </section>
              );
            })}
          </nav>
          <div className="progress-rail" aria-label="Workflow progress">
            <span className="progress-ring" aria-hidden="true" />
            <strong>Progress</strong>
            <small>{nodes.length > 0 ? "Review in progress" : status}</small>
          </div>
        </aside>
        <ResizeHandle
          orientation="vertical"
          value={railWidth}
          min={MIN_RAIL_WIDTH}
          max={MAX_RAIL_WIDTH}
          label="Resize workflow sidebar width"
          onChange={setRailWidth}
        />
        <section className="workspace-main" aria-label="Conflation workspace">
          <section className="map-column" aria-labelledby="map-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Map</p>
                <h2 id="map-heading">Candidate map</h2>
              </div>
              <p className="workspace-status" role="status" aria-live="polite">
                {status}
              </p>
            </div>
            <MapView
              nodes={nodes}
              stops={stops}
              matches={matches}
              reviews={reviews}
              validStopIds={validStopIds}
              exactMatchRadiusMeters={profile.autoIdRadiusMeters}
              focusedFeatureId={focusedFeatureId}
              onFeatureClick={setFocusedFeatureId}
              theme={theme}
              styleUrl={styleUrl.length > 0 ? styleUrl : undefined}
            />
          </section>
          <ResizeHandle
            orientation="horizontal"
            value={reviewHeight}
            min={MIN_REVIEW_HEIGHT}
            max={MAX_REVIEW_HEIGHT}
            label="Resize map and review panels"
            onChange={setReviewHeight}
          />
          {retrievalComplete ? (
            <section
              id="review-step"
              className="review-workspace"
              aria-labelledby="review-heading"
            >
              <ReviewQueue
                stops={stops}
                matches={matches}
                reviews={reviews}
                nodes={nodes}
                validStopIds={validStopIds}
                exactMatchRadiusMeters={profile.autoIdRadiusMeters}
                onAction={applyAction}
                focusedFeatureId={focusedFeatureId}
                onFocusFeature={setFocusedFeatureId}
              />
            </section>
          ) : (
            <section
              id="review-step"
              className="review-empty"
              aria-labelledby="review-empty-heading"
            >
              <p className="eyebrow">Conflation queue</p>
              <h2 id="review-empty-heading">Review items will appear here</h2>
              <p>
                {stops.length === 0
                  ? "Import a local feed and retrieve OSM candidates to begin comparing stops."
                  : "Retrieve OSM candidates to load the review queue."}
              </p>
            </section>
          )}
        </section>
      </div>
    </main>
  );
}

export default App;
