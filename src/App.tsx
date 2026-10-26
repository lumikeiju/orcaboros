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
import { ProgressRing } from "./components/ProgressRing";
import { ProfileEditor } from "./components/ProfileEditor";
import { ReviewQueue } from "./components/ReviewQueue";
import { MapView } from "./components/MapView";
import { ThemeToggle, type Theme } from "./components/ThemeToggle";
import { ResizeHandle } from "./components/ResizeHandle";
import { IntroWarning } from "./components/IntroWarning";
import {
  OsmRequestResult,
  type OsmRequestResultState
} from "./components/OsmRequestResult";
import {
  createCustomProfileForFeedIds,
  fingerprintProfile,
  getDefaultProfile,
  getProfileForFeedIds,
  serializeProfile
} from "./profiles";
import { evaluateRemovalKeys, MappingProfile } from "./domain/profile";
import {
  applyStreetNameCleanup,
  EligibleStop,
  FeedImportResult
} from "./domain/gtfs";
import { InitialMatch, validateSelectedClaims } from "./domain/matching";
import {
  FeatureReview,
  applyReviewAction,
  buildTagProposals,
  computeConflationProgress,
  firstUndecidedFeatureId,
  computePostChangeTags,
  legacyIdentityKeys,
  selectedElementRef,
  staleIdentityKeys
} from "./domain/review";
import {
  elementKey,
  isOsmWay,
  osmElementRef,
  OsmElement,
  OsmTagSet
} from "./domain/osm";
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
  retrieveOverpassElements,
  workingBoundsForStops
} from "./infrastructure/osm";
import { matchStopsInWorker } from "./features/matching/worker-client";
import { mapStopToOsmTags } from "./infrastructure/gtfs";
import {
  createProgressThrottleState,
  shouldPublishProgress
} from "./infrastructure/browser/progress";
import {
  createDefaultOsmFileName,
  downloadTextFile
} from "./infrastructure/browser/download";
import {
  ExportValidationError,
  serializeJosmOsm,
  type ExportValidationIssue
} from "./infrastructure/osm/change-export";
import {
  CONSOLIDATED_SOURCE_FEED_ID,
  DEFAULT_GEOMETRY_TARGET,
  DEFAULT_STREET_NAME_CLEANUP,
  type GeometryTarget,
  normalizeSourceFeedId,
  STOCK_SOURCE_FEED_DEFINITIONS
} from "./domain/source-feed";
import {
  IndexedDbSessionRepository,
  MemorySessionRepository,
  SessionRepository,
  StoredSession,
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
type WorkflowStepStatusKind =
  "attention" | "complete" | "progress" | "ready" | "start" | "waiting";
type WorkflowStepStatus = {
  label: string;
  kind: WorkflowStepStatusKind;
};
type ExportErrorState = {
  message: string;
  issues: readonly ExportValidationIssue[];
};

const MIN_RAIL_WIDTH = 18;
const MAX_RAIL_WIDTH = 36;
const MIN_REVIEW_HEIGHT = 20;
const MAX_REVIEW_HEIGHT = 77;

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

function applyProfileToStop(
  profile: MappingProfile,
  stop: EligibleStop
): EligibleStop {
  const sourceFeed = profile.sourceFeeds.find(
    (candidate) => candidate.id === stop.sourceFeedId
  );
  return applyStreetNameCleanup(
    {
      ...stop,
      sourceFeedName: sourceFeed?.displayName ?? stop.sourceFeedName,
      sourceFeedMetadata: sourceFeed?.metadata ?? {}
    },
    sourceFeed?.streetNameCleanup ?? DEFAULT_STREET_NAME_CLEANUP
  );
}

export function App(): ReactElement {
  const [theme, setTheme] = useState<Theme>("dark");
  const [profile, setProfile] = useState<MappingProfile>(getDefaultProfile());
  const [autoMatchedStockProfile, setAutoMatchedStockProfile] = useState(false);
  const [archives, setArchives] = useState<readonly SelectedArchive[]>([]);
  const [archiveProfile, setArchiveProfile] = useState<MappingProfile>();
  const [archiveProfileAutoMatched, setArchiveProfileAutoMatched] =
    useState(false);
  const [selectionErrors, setSelectionErrors] = useState<readonly string[]>([]);
  const [stops, setStops] = useState<readonly EligibleStop[]>([]);
  const [feedSummaries, setFeedSummaries] = useState<
    readonly FeedImportResult[]
  >([]);
  const [validStopIds, setValidStopIds] = useState<
    ReadonlyMap<string, ReadonlySet<string>>
  >(new Map());
  const [nodes, setNodes] = useState<readonly OsmElement[]>([]);
  const [retrievalComplete, setRetrievalComplete] = useState(false);
  const [matches, setMatches] = useState<ReadonlyMap<string, InitialMatch>>(
    new Map()
  );
  const [reviews, setReviews] = useState<ReadonlyMap<string, FeatureReview>>(
    new Map()
  );
  const [focusedFeatureId, setFocusedFeatureId] = useState<string>();
  const [reviewQueueFocusRequest, setReviewQueueFocusRequest] = useState(0);
  const [openWorkflowStep, setOpenWorkflowStep] = useState<
    WorkflowStepId | undefined
  >();
  const [profileReviewed, setProfileReviewed] = useState(false);
  const [railWidth, setRailWidth] = useState(25);
  const [reviewHeight, setReviewHeight] = useState(46);
  const [endpoint, setEndpoint] = useState("");
  const [styleUrl, setStyleUrl] = useState("");
  const [status, setStatus] = useState("Upload GTFS ZIPs to begin.");
  const [error, setError] = useState<string | undefined>();
  const [exportError, setExportError] = useState<ExportErrorState>();
  const exportErrorFeatureIds =
    exportError === undefined
      ? []
      : Array.from(
          new Set(exportError.issues.flatMap((issue) => issue.featureIds))
        );
  const [loading, setLoading] = useState(false);
  const [resetConfirmationOpen, setResetConfirmationOpen] = useState(false);
  const resetSessionButtonRef = useRef<HTMLButtonElement>(null);
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
  const sessionGeneration = useRef(0);
  const activeSessionId = useRef<string | undefined>(undefined);
  const activeSnapshotId = useRef<string | undefined>(undefined);
  const pendingSessionWrite = useRef<Promise<void>>(Promise.resolve());
  const repository = useMemo<SessionRepository>(
    () =>
      typeof indexedDB === "undefined"
        ? new MemorySessionRepository()
        : new IndexedDbSessionRepository(),
    []
  );

  function updateStoredSession(
    update: (session: StoredSession) => StoredSession | Promise<StoredSession>,
    allowMissing = false
  ): Promise<void> {
    const expectedSessionId = activeSessionId.current;
    const operation = async (): Promise<void> => {
      const session = await repository.getActiveSession();
      if (session === undefined) {
        if (allowMissing) {
          return;
        }
        throw new Error("The active GTFS session is no longer available.");
      }
      if (
        expectedSessionId !== undefined &&
        session.manifest.sessionId !== expectedSessionId
      ) {
        throw new Error(
          "The active session changed in another tab. Reload before continuing."
        );
      }
      await repository.putActiveSession(await update(session));
    };
    const write = pendingSessionWrite.current.then(operation);
    pendingSessionWrite.current = write.then(
      () => undefined,
      (caught: unknown) => {
        setError(
          caught instanceof Error
            ? caught.message
            : "The session could not be saved."
        );
      }
    );
    return write;
  }
  const availableFields = useMemo(
    () => [...new Set(feedSummaries.flatMap((summary) => summary.fields))],
    [feedSummaries]
  );
  const mappedTagsByFeature = useMemo(
    () =>
      new Map(
        stops.map((stop): [string, OsmTagSet] => [
          stop.featureId,
          mapStopToOsmTags(profile, stop)
        ])
      ),
    [profile, stops]
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
    const controller = new AbortController();
    const generation = sessionGeneration.current;
    void repository
      .getActiveSession()
      .then(async (session) => {
        if (
          !active ||
          session === undefined ||
          generation !== sessionGeneration.current
        ) {
          return;
        }
        const restoredProfile: MappingProfile = {
          ...session.profile,
          sourceFeeds: session.profile.sourceFeeds.map((sourceFeed) => ({
            ...sourceFeed,
            geometryTarget:
              sourceFeed.geometryTarget ?? DEFAULT_GEOMETRY_TARGET,
            streetNameCleanup:
              sourceFeed.streetNameCleanup ?? DEFAULT_STREET_NAME_CLEANUP
          }))
        };
        const remapStop = (stop: EligibleStop): EligibleStop =>
          applyProfileToStop(restoredProfile, stop);
        const restoredStops = session.sourceFeeds.flatMap((source) =>
          source.eligibleStops.map(remapStop)
        );
        restoredStops.forEach((stop) =>
          mapStopToOsmTags(restoredProfile, stop)
        );
        const restoredMatches =
          session.osmSnapshot === undefined
            ? new Map<string, InitialMatch>()
            : await matchStopsInWorker(
                restoredStops,
                session.osmSnapshot.nodes,
                restoredProfile.candidateRadiusMeters,
                restoredProfile.autoIdRadiusMeters,
                undefined,
                controller.signal
              );
        if (!active || generation !== sessionGeneration.current) {
          return;
        }
        activeSessionId.current = session.manifest.sessionId;
        activeSnapshotId.current = session.osmSnapshot?.snapshotId;
        setProfile(restoredProfile);
        setMatches(restoredMatches);
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
            eligibleStops: source.eligibleStops.map(remapStop),
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
      controller.abort();
    };
  }, [repository]);

  useEffect(
    () => () => {
      activeImportHandle.current?.cancel();
      osmAbortController.current?.abort();
    },
    []
  );

  async function importSelectedArchives(): Promise<void> {
    if (archives.length === 0 || selectionErrors.length > 0) {
      setError("Select at least one enabled ZIP archive before importing.");
      return;
    }
    const importProfile = archiveProfile ?? profile;
    const enabledDefinitions = importProfile.sourceFeeds.filter(
      (source) => source.enabled
    );
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
    sessionGeneration.current += 1;
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
        importProfile,
        imported
      );
      const nextStops = imported.flatMap((item) => item.result.eligibleStops);
      nextStops.forEach((stop) => mapStopToOsmTags(importProfile, stop));
      await pendingSessionWrite.current;
      await stageAndActivateSession(repository, stagedSession);
      activeSessionId.current = stagedSession.manifest.sessionId;
      activeSnapshotId.current = undefined;
      setProfile(importProfile);
      setAutoMatchedStockProfile(archiveProfileAutoMatched);
      setArchiveProfile(undefined);
      setProfileReviewed(false);
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
    setArchives(nextArchives);
    setArchiveProfile(undefined);
    setArchiveProfileAutoMatched(false);
    setSelectionErrors(errors);
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
          const matchedProfile = getProfileForFeedIds(selectableFeedIds);
          setArchiveProfile(
            matchedProfile ?? createCustomProfileForFeedIds(selectableFeedIds)
          );
          setArchiveProfileAutoMatched(matchedProfile !== undefined);
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
    const previousRetrievalComplete = retrievalComplete;
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
      const sourceFeedIds = [
        ...new Set(stops.map((stop) => stop.sourceFeedId))
      ];
      const identityKeys = identityKeysForSourceFeeds(sourceFeedIds);
      const requests = buildOverpassRequests(bounds, identityKeys);
      setOsmProgress({ phase: "query", processed: 0, total: requests.length });
      const nodesById = new Map<string, OsmElement>();
      for (const [requestIndex, request] of requests.entries()) {
        setStatus(
          `Retrieving OSM candidates (${requestIndex + 1}/${requests.length})`
        );
        const requestNodes = await retrieveOverpassElements(
          endpoint,
          request.query,
          controller.signal
        );
        requestNodes.forEach((node) => nodesById.set(elementKey(node), node));
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
              elementCount: retrieved.length,
              requestCount: requests.length
            }
      );
      const snapshotId = crypto.randomUUID();
      const snapshotTimestamp = new Date().toISOString();
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
        },
        controller.signal
      );
      const initialReviews = new Map(
        stops.map((stop) => {
          const result = initial.get(stop.featureId);
          const node =
            result?.kind === "auto-matched" ? result.candidate.node : undefined;
          const mappedTags = mapStopToOsmTags(profile, stop);
          const staleKeys =
            node === undefined
              ? []
              : staleIdentityKeys(node, sourceFeedIds, validStopIds);
          const removeKeys =
            node === undefined
              ? []
              : [
                  ...new Set([
                    ...legacyIdentityKeys(node, stop),
                    ...evaluateRemovalKeys(profile, stop)
                  ])
                ];
          return [
            stop.featureId,
            {
              featureId: stop.featureId,
              state:
                result?.kind === "auto-matched" ? "auto-matched" : "unreviewed",
              selectedNodeId:
                node !== undefined && !isOsmWay(node) ? node.id : undefined,
              selectedElement:
                node === undefined ? undefined : osmElementRef(node),
              createCoordinates: undefined,
              proposals: buildTagProposals(
                node,
                mappedTags,
                staleKeys,
                removeKeys
              )
            } satisfies FeatureReview
          ];
        })
      );
      controller.signal.throwIfAborted();
      const profileFingerprint = await fingerprintProfile(profile);
      await updateStoredSession((activeSession) => {
        controller.signal.throwIfAborted();
        return {
          ...activeSession,
          profile,
          sourceFeeds: activeSession.sourceFeeds.map((sourceFeed) => ({
            ...sourceFeed,
            eligibleStops: sourceFeed.eligibleStops.map((stop) =>
              applyProfileToStop(profile, stop)
            )
          })),
          osmSnapshot: {
            snapshotId,
            timestamp: snapshotTimestamp,
            bounds,
            nodes: retrieved
          },
          reviews: [...initialReviews.values()],
          draft: undefined,
          manifest: {
            ...activeSession.manifest,
            mappingProfileSchemaVersion: profile.schemaVersion,
            mappingProfileFingerprint: profileFingerprint,
            osmSnapshotId: snapshotId,
            osmSnapshotTimestamp: snapshotTimestamp,
            osmSnapshotBounds: bounds,
            reviewStateVersion: activeSession.manifest.reviewStateVersion + 1,
            draftVersion: activeSession.manifest.draftVersion + 1
          }
        };
      });
      activeSnapshotId.current = snapshotId;
      setNodes(retrieved);
      setMatches(initial);
      setReviews(initialReviews);
      setRetrievalComplete(true);
      setStatus(
        retrieved.length === 0
          ? "Overpass returned no OSM candidate elements."
          : `Retrieved ${retrieved.length} OSM candidate elements for review.`
      );
    } catch (caught: unknown) {
      setRetrievalComplete(previousRetrievalComplete);
      const cancelled =
        (caught instanceof OverpassRequestError &&
          caught.category === "cancelled") ||
        (caught instanceof DOMException && caught.name === "AbortError");
      const message =
        caught instanceof Error
          ? caught.message
          : "The OSM candidate request failed.";
      setOsmRequestResult(
        cancelled ? { kind: "cancelled" } : { kind: "failed", message }
      );
      setStatus(
        cancelled ? "Overpass request cancelled." : "Overpass request failed."
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
    const current =
      reviews.get(featureId) ??
      (action.type === "skip" &&
      nodes.some(
        (node) =>
          `removed-${isOsmWay(node) ? elementKey(node) : node.id}` === featureId
      )
        ? {
            featureId,
            state: "unreviewed" as const,
            selectedNodeId: undefined,
            createCoordinates: undefined,
            proposals: []
          }
        : undefined);
    if (current === undefined) {
      return;
    }
    const stop = stops.find((candidate) => candidate.featureId === featureId);
    let updated = applyReviewAction(current, action);
    if (
      stop !== undefined &&
      (action.type === "select-match" ||
        action.type === "select-element" ||
        action.type === "select-create")
    ) {
      const selected =
        action.type === "select-match"
          ? { type: "node" as const, id: action.nodeId }
          : action.type === "select-element"
            ? action.element
            : undefined;
      const node =
        selected === undefined
          ? undefined
          : nodes.find(
              (candidate) => elementKey(candidate) === elementKey(selected)
            );
      const staleKeys =
        node === undefined
          ? []
          : staleIdentityKeys(
              node,
              [...new Set(stops.map((candidate) => candidate.sourceFeedId))],
              validStopIds
            );
      const removeKeys =
        node === undefined
          ? []
          : [
              ...new Set([
                ...legacyIdentityKeys(node, stop),
                ...evaluateRemovalKeys(profile, stop)
              ])
            ];
      updated = {
        ...updated,
        proposals: buildTagProposals(
          node,
          mapStopToOsmTags(profile, stop),
          staleKeys,
          removeKeys
        )
      };
    }
    const nextReviews = new Map(reviews).set(featureId, updated);
    setReviews(nextReviews);
    void persistReviews(nextReviews).catch((caught: unknown) => {
      setError(
        caught instanceof Error
          ? caught.message
          : "The review decision could not be saved."
      );
    });
  }

  async function persistReviews(
    nextReviews: ReadonlyMap<string, FeatureReview>
  ): Promise<void> {
    const snapshotId = activeSnapshotId.current;
    await updateStoredSession((activeSession) => {
      if (
        snapshotId === undefined ||
        activeSession.osmSnapshot?.snapshotId !== snapshotId
      ) {
        throw new Error(
          "The OSM snapshot changed. Retrieve candidates again before saving decisions."
        );
      }
      return {
        ...activeSession,
        reviews: [...nextReviews.values()],
        draft: undefined
      };
    });
  }

  function createDraft(sessionId: string, snapshotId: string): ChangeDraft {
    const claimIssues = validateSelectedClaims(
      stops.flatMap((stop) => {
        const review = reviews.get(stop.featureId);
        if (
          review === undefined ||
          (review.state !== "match-selected" && review.state !== "auto-matched")
        ) {
          return [];
        }
        const elementRef = selectedElementRef(review);
        return elementRef === undefined ? [] : [{ feature: stop, elementRef }];
      })
    );
    if (claimIssues.length > 0) {
      throw new Error(claimIssues.join("; "));
    }
    const elementByKey = new Map(nodes.map((node) => [elementKey(node), node]));
    const creates: DraftCreate[] = [];
    const modifications = new Map<string, DraftModify>();
    const tagDecisions = new Map<string, Map<string, string | undefined>>();
    for (const stop of stops) {
      const review = reviews.get(stop.featureId);
      if (
        review === undefined ||
        review.state === "skipped" ||
        review.state === "unreviewed"
      ) {
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
      const selected = selectedElementRef(review);
      if (selected === undefined) {
        throw new Error(`${stop.featureId} has no selected OSM element`);
      }
      const element = elementByKey.get(elementKey(selected));
      if (element === undefined) {
        throw new Error(
          `${stop.featureId} refers to an element outside the current snapshot`
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
        element
      );
      const existing = modifications.get(elementKey(element));
      if (
        existing !== undefined &&
        (existing.coordinates.latitude !== coordinates.latitude ||
          existing.coordinates.longitude !== coordinates.longitude)
      ) {
        throw new Error(
          `${element.id} has conflicting geometry targets for selected features`
        );
      }
      const ownTags = computePostChangeTags(element.tags, review.proposals);
      const decisions =
        tagDecisions.get(elementKey(element)) ??
        new Map<string, string | undefined>();
      const tags = new Map(Object.entries(existing?.tags ?? element.tags));
      for (const proposal of review.proposals) {
        const value = Object.hasOwn(ownTags, proposal.key)
          ? ownTags[proposal.key]
          : undefined;
        if (
          decisions.has(proposal.key) &&
          decisions.get(proposal.key) !== value
        ) {
          throw new Error(
            `${elementKey(element)} has conflicting tag decisions for ${proposal.key} across selected features`
          );
        }
        decisions.set(proposal.key, value);
        if (value === undefined) {
          tags.delete(proposal.key);
        } else {
          tags.set(proposal.key, value);
        }
      }
      tagDecisions.set(elementKey(element), decisions);
      modifications.set(elementKey(element), {
        node: element,
        coordinates,
        featureIds: [...(existing?.featureIds ?? []), stop.featureId],
        tags: Object.fromEntries(tags)
      });
    }
    return {
      sessionId,
      snapshotId,
      creates,
      modifications: [...modifications.values()]
    };
  }

  async function exportDraft(): Promise<void> {
    setLoading(true);
    setExportError(undefined);
    try {
      let xml = "";
      await updateStoredSession((activeSession) => {
        const snapshotId = activeSnapshotId.current;
        if (
          snapshotId === undefined ||
          activeSession.osmSnapshot?.snapshotId !== snapshotId
        ) {
          throw new Error(
            "The OSM snapshot changed. Retrieve candidates again before exporting."
          );
        }
        const draft = createDraft(activeSession.manifest.sessionId, snapshotId);
        xml = serializeJosmOsm(draft);
        return {
          ...activeSession,
          reviews: [...reviews.values()],
          draft
        };
      });
      downloadTextFile(xml, createDefaultOsmFileName(), "application/xml");
      setStatus(
        "Downloaded the JOSM OSM file. Open it in JOSM for final review."
      );
      setError(undefined);
    } catch (caught: unknown) {
      if (caught instanceof ExportValidationError) {
        setError(undefined);
        const issueCount = caught.issues.length;
        setExportError({
          message: `OSM Change export is invalid (${issueCount} issue${issueCount === 1 ? "" : "s"}). Review the details below.`,
          issues: caught.issues
        });
      } else {
        setExportError({
          message:
            caught instanceof Error
              ? caught.message
              : "The OSM Change export is invalid.",
          issues: []
        });
      }
      setStatus("OSM Change export failed.");
    } finally {
      setLoading(false);
    }
  }

  async function resetSession(): Promise<boolean> {
    setLoading(true);
    try {
      sessionGeneration.current += 1;
      activeImportHandle.current?.cancel();
      osmAbortController.current?.abort();
      await pendingSessionWrite.current;
      await repository.resetActiveSession();
      activeSessionId.current = undefined;
      activeSnapshotId.current = undefined;
      setProfileReviewed(false);
      setAutoMatchedStockProfile(false);
      setArchives([]);
      setArchiveProfile(undefined);
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
      setExportError(undefined);
      setError(undefined);
      setStatus("Session reset. Upload GTFS ZIPs to begin.");
      setResetConfirmationOpen(false);
      return true;
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The active session could not be reset."
      );
      return false;
    } finally {
      setLoading(false);
    }
  }

  function cancelSessionReset(): void {
    setResetConfirmationOpen(false);
    resetSessionButtonRef.current?.focus();
  }

  async function confirmSessionReset(): Promise<void> {
    if (await resetSession()) {
      document.getElementById("gtfs-files")?.focus();
    }
  }

  async function handleProfileChange(
    nextProfile: MappingProfile,
    isAutoMatchedStockProfile = false
  ): Promise<void> {
    const remapStop = (stop: EligibleStop): EligibleStop =>
      applyProfileToStop(nextProfile, stop);
    const nextStops = stops.map(remapStop);
    try {
      serializeProfile(nextProfile);
      if (
        feedSummaries.some(
          (summary) =>
            !nextProfile.sourceFeeds.some(
              (sourceFeed) =>
                sourceFeed.enabled && sourceFeed.id === summary.sourceFeedId
            )
        )
      ) {
        throw new Error("The profile must enable every imported source feed.");
      }
      nextStops.forEach((stop) => mapStopToOsmTags(nextProfile, stop));
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The profile produces invalid OSM tags."
      );
      return;
    }
    sessionGeneration.current += 1;
    activeSnapshotId.current = undefined;
    setError(undefined);
    setProfileReviewed(false);
    setAutoMatchedStockProfile(isAutoMatchedStockProfile);
    setProfile(nextProfile);
    setStops(nextStops);
    setFeedSummaries((currentSummaries) =>
      currentSummaries.map((summary) => ({
        ...summary,
        eligibleStops: summary.eligibleStops.map(remapStop)
      }))
    );
    setNodes([]);
    setRetrievalComplete(false);
    setOsmRequestResult(undefined);
    setMatches(new Map());
    setReviews(new Map());
    setFocusedFeatureId(undefined);
    try {
      await updateStoredSession(async (activeSession) => {
        const profileFingerprint = await fingerprintProfile(nextProfile);
        return {
          ...activeSession,
          profile: nextProfile,
          sourceFeeds: activeSession.sourceFeeds.map((sourceFeed) => ({
            ...sourceFeed,
            eligibleStops: sourceFeed.eligibleStops.map(remapStop)
          })),
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
        };
      }, true);
    } catch (caught: unknown) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The profile change could not invalidate the current snapshot."
      );
    }
  }

  const exportableDecisionCount = [...reviews.values()].filter(
    (review) =>
      review.state === "auto-matched" ||
      review.state === "match-selected" ||
      review.state === "create-selected"
  ).length;

  const exportBlocked =
    loading || !retrievalComplete || exportableDecisionCount === 0;

  const currentWorkflowStep = openWorkflowStep ?? "upload";
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
      detail: "Upload GTFS ZIPs"
    },
    {
      id: "profile",
      number: "2",
      label: "Profile",
      detail: "Review field mappings"
    },
    {
      id: "retrieve",
      number: "3",
      label: "Retrieve",
      detail: "Retrieve OSM data"
    },
    {
      id: "review",
      number: "4",
      label: "Review",
      detail: "Review each feature"
    },
    {
      id: "export",
      number: "5",
      label: "Export",
      detail: "Download for JOSM"
    }
  ] as const;

  const decidedReviewCount = stops.filter((stop) => {
    const state = reviews.get(stop.featureId)?.state;
    return state !== undefined && state !== "unreviewed";
  }).length;

  const conflationProgress = computeConflationProgress({
    stops,
    nodes,
    reviews,
    validStopIds
  });

  const hasImportedStops = feedSummaries.length > 0 && stops.length > 0;
  const allReviewItemsResolved =
    conflationProgress.total > 0 &&
    conflationProgress.resolved === conflationProgress.total;
  const workflowStepStatuses: Readonly<
    Record<WorkflowStepId, WorkflowStepStatus>
  > = {
    upload: importActive
      ? { label: "Importing", kind: "progress" }
      : feedSummaries.length > 0
        ? stops.length > 0
          ? { label: "Imported", kind: "complete" }
          : { label: "Check import", kind: "attention" }
        : archives.length > 0
          ? selectionErrors.length > 0
            ? { label: "Fix selection", kind: "attention" }
            : { label: "Ready", kind: "ready" }
          : { label: "Start here", kind: "start" },
    profile: hasImportedStops
      ? profileReviewed
        ? { label: "Reviewed", kind: "complete" }
        : { label: "Ready", kind: "ready" }
      : { label: "Waiting", kind: "waiting" },
    retrieve: retrievalComplete
      ? { label: "Retrieved", kind: "complete" }
      : osmRequestActive
        ? { label: "Retrieving", kind: "progress" }
        : hasImportedStops
          ? { label: "Ready", kind: "ready" }
          : { label: "Waiting", kind: "waiting" },
    review: !retrievalComplete
      ? { label: "Waiting", kind: "waiting" }
      : conflationProgress.total === 0
        ? { label: "No items", kind: "attention" }
        : allReviewItemsResolved
          ? { label: "Complete", kind: "complete" }
          : conflationProgress.resolved > 0
            ? {
                label: `${conflationProgress.resolved}/${conflationProgress.total}`,
                kind: "progress"
              }
            : { label: "Ready", kind: "ready" },
    export: !retrievalComplete
      ? { label: "Waiting", kind: "waiting" }
      : exportBlocked
        ? { label: "Needs decisions", kind: "waiting" }
        : { label: "Ready", kind: "ready" }
  };

  function navigateToWorkflowStep(stepId: WorkflowStepId): void {
    setOpenWorkflowStep(stepId);
    document.getElementById(`workflow-step-${stepId}`)?.focus();
  }

  function reviewProfileAndContinue(): void {
    setProfileReviewed(true);
    navigateToWorkflowStep("retrieve");
  }

  function openReviewQueue(targetFeatureId?: string): void {
    const featureId =
      targetFeatureId ??
      firstUndecidedFeatureId({
        stops,
        nodes,
        reviews,
        validStopIds
      }) ??
      stops[0]?.featureId;
    setFocusedFeatureId(featureId);
    setReviewQueueFocusRequest((request) => request + 1);
    setOpenWorkflowStep("review");
    document
      .getElementById("review-step")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

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
              disabled={loading}
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
                    importProgress.totalBytes > 0
                      ? importProgress.bytesRead
                      : undefined
                  }
                  max={
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
                      : "Process selected GTFS ZIPs"}
                </button>
                <button
                  ref={resetSessionButtonRef}
                  type="button"
                  className="secondary"
                  aria-expanded={resetConfirmationOpen}
                  aria-controls="reset-confirmation"
                  onClick={() => setResetConfirmationOpen(true)}
                  disabled={loading}
                >
                  Reset current session
                </button>
              </div>
              <div
                id="reset-confirmation"
                className="reset-confirmation glass-pane glass-pane--level-3 glass-pane--compact"
                role="group"
                aria-labelledby="reset-confirmation-heading"
                hidden={!resetConfirmationOpen}
              >
                <p id="reset-confirmation-heading">
                  Reset this session? Imported stops, OSM candidates, and review
                  decisions stored in this browser will be cleared.
                </p>
                <div className="button-row">
                  <button
                    type="button"
                    className="secondary"
                    onClick={cancelSessionReset}
                    disabled={loading}
                  >
                    Keep current session
                  </button>
                  <button
                    type="button"
                    className="reset-confirmation-delete glass-button glass-button--danger"
                    onClick={() => void confirmSessionReset()}
                    disabled={loading}
                  >
                    {loading ? "Resetting…" : "Reset session"}
                  </button>
                </div>
              </div>
              {feedSummaries.length > 0 && (
                <div
                  className="diagnostics glass-pane glass-pane--level-3 glass-pane--compact"
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
              {hasImportedStops && (
                <button
                  type="button"
                  className="workflow-next-step glass-button--accent"
                  onClick={() => navigateToWorkflowStep("profile")}
                >
                  Continue to profile mapping
                </button>
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
              disabled={loading}
              autoMatchedStockProfile={autoMatchedStockProfile}
              availableFields={availableFields}
              availableFieldsByFeed={
                new Map(
                  feedSummaries.map((summary) => [
                    summary.sourceFeedId,
                    summary.fields
                  ])
                )
              }
              uploadedFeedIds={feedSummaries.map(
                (summary) => summary.sourceFeedId
              )}
              exampleStops={stops}
              exampleRowCounts={exampleRowCounts}
              onChange={(nextProfile) => void handleProfileChange(nextProfile)}
              onReset={() => void handleProfileChange(getDefaultProfile())}
            />
            {hasImportedStops && (
              <button
                type="button"
                className="workflow-next-step glass-button--accent"
                onClick={reviewProfileAndContinue}
              >
                Continue to OSM retrieval
              </button>
            )}
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
                  stored. Requests retrieve OSM nodes and tagged platform ways,
                  bounded by the candidate radius.
                </p>
                <div className="endpoint-field">
                  <div className="endpoint-field-header">
                    <label htmlFor="overpass-endpoint">
                      HTTPS Overpass-compatible endpoint
                    </label>
                    <a
                      aria-label="Find public Overpass API instances"
                      className="endpoint-info-link"
                      href="https://wiki.openstreetmap.org/wiki/Overpass_API#Public_Overpass_API_instances"
                      rel="noreferrer"
                      target="_blank"
                      title="Public Overpass API instances"
                    >
                      <span aria-hidden="true">i</span>
                    </a>
                  </div>
                  <input
                    id="overpass-endpoint"
                    type="password"
                    autoComplete="off"
                    disabled={loading}
                    value={endpoint}
                    onChange={(event) => setEndpoint(event.target.value)}
                    placeholder="https://your-overpass.example/api/interpreter"
                  />
                </div>
                <label className="style-url-label">
                  Optional session-only MapLibre style URL
                  <input
                    type="url"
                    autoComplete="off"
                    disabled={loading}
                    value={styleUrl}
                    onChange={(event) => setStyleUrl(event.target.value)}
                    placeholder="Leave blank for Fiord dark / Positron light"
                  />
                </label>
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
                <div className="retrieve-actions">
                  <div className="retrieve-request-actions">
                    <button
                      type="button"
                      onClick={() => void retrieveCandidates()}
                      disabled={loading}
                    >
                      Retrieve Candidates
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => osmAbortController.current?.abort()}
                      disabled={!osmRequestActive}
                    >
                      Cancel OSM Request
                    </button>
                  </div>
                  {retrievalComplete && (
                    <button
                      type="button"
                      className="workflow-next-step glass-button--accent"
                      onClick={() => openReviewQueue()}
                    >
                      Continue to review
                    </button>
                  )}
                </div>
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
                  className="workflow-next-step glass-button--accent"
                  onClick={() => openReviewQueue()}
                >
                  Open Review Queue
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
            ) : !retrievalComplete ? (
              <p className="workflow-step-hint">
                Retrieve OSM candidates before exporting.
              </p>
            ) : (
              <>
                <p>
                  Export downloads every resolved decision so far, including
                  auto-matches. Unreviewed features are left out of the file, so
                  you can export partial progress or wait until every feature
                  has been reviewed.
                </p>
                <p>
                  <strong>{exportableDecisionCount.toLocaleString()}</strong> of{" "}
                  {stops.length.toLocaleString()} feature(s) ready to export.
                </p>
                <button
                  type="button"
                  onClick={() => void exportDraft()}
                  disabled={exportBlocked}
                >
                  Download JOSM OSM File
                </button>
                {exportError !== undefined && (
                  <>
                    <p className="error" role="alert">
                      {exportError.message}
                    </p>
                    {exportError.issues.length > 0 && (
                      <div className="export-error-details">
                        <ul className="export-error-issues">
                          {exportError.issues.map((issue, index) => (
                            <li key={`${issue.message}-${index}`}>
                              {issue.message}
                            </li>
                          ))}
                        </ul>
                        {exportErrorFeatureIds.length > 0 && (
                          <>
                            <p className="export-error-affected-label">
                              <strong>Affected review items:</strong>
                            </p>
                            <ul className="export-error-items">
                              {exportErrorFeatureIds.map((featureId) => {
                                const stop = stops.find(
                                  (candidate) =>
                                    candidate.featureId === featureId
                                );
                                return (
                                  <li key={featureId}>
                                    {stop === undefined ? (
                                      `Review item ${featureId} is no longer available.`
                                    ) : (
                                      <a
                                        className="export-error-focus-link"
                                        href="#review-step"
                                        onClick={(event) => {
                                          event.preventDefault();
                                          openReviewQueue(featureId);
                                        }}
                                      >
                                        Focus {stop.stopNameExpanded} (
                                        {stop.sourceFeedId}; Stop code:{" "}
                                        {stop.rawFields.stop_code?.trim() ||
                                          "—"}
                                        )
                                      </a>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
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
      <a className="skip-link" href="#workspace-main">
        Skip to workspace
      </a>
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
          <nav
            className="workflow-nav glass-scrollbar"
            aria-label="Workflow steps"
          >
            {workflowSteps.map((step) => {
              const isOpen = openWorkflowStep === step.id;
              const panelId = `${step.id}-step-panel`;
              const stepStatus = workflowStepStatuses[step.id];
              return (
                <section
                  className={`workflow-step${isOpen ? " is-open" : ""}`}
                  key={step.id}
                >
                  <button
                    id={`workflow-step-${step.id}`}
                    className={`workflow-step-link${
                      currentWorkflowStep === step.id ? " is-active" : ""
                    }${stepStatus.kind === "start" ? " is-start" : ""}`}
                    type="button"
                    aria-label={`${step.number} ${step.label} ${step.detail}. ${stepStatus.label}`}
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
                    <span className="workflow-step-copy">
                      <strong>{step.label}</strong>
                      <small>{step.detail}</small>
                    </span>
                    <span
                      className={`workflow-step-status is-${stepStatus.kind}`}
                    >
                      {stepStatus.label}
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
          <div
            className="progress-rail"
            role="group"
            aria-label="Review progress"
          >
            <ProgressRing
              resolved={conflationProgress.resolved}
              total={conflationProgress.total}
            />
            <div className="progress-rail-copy">
              <strong>Review progress</strong>
              <small>{nodes.length > 0 ? "Review in progress" : status}</small>
            </div>
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
        <section
          id="workspace-main"
          className="workspace-main"
          aria-label="Conflation workspace"
          tabIndex={-1}
        >
          <section className="map-column" aria-labelledby="map-heading">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Map</p>
                <h2 id="map-heading">Candidate map</h2>
              </div>
              {error !== undefined &&
                (openWorkflowStep !== "export" ||
                  error !== exportError?.message) && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
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
              mappedTagsByFeature={mappedTagsByFeature}
              exactMatchRadiusMeters={profile.autoIdRadiusMeters}
              focusedFeatureId={focusedFeatureId}
              onFeatureClick={setFocusedFeatureId}
              onAction={loading ? undefined : applyAction}
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
              className="review-workspace glass-background glass-background--level-1"
              aria-labelledby="review-heading"
              aria-busy={loading}
              inert={loading}
            >
              <ReviewQueue
                stops={stops}
                matches={matches}
                reviews={reviews}
                nodes={nodes}
                validStopIds={validStopIds}
                geometryTargets={
                  new Map<string, GeometryTarget>(
                    profile.sourceFeeds.map(({ id, geometryTarget }) => [
                      id,
                      geometryTarget
                    ])
                  )
                }
                exactMatchRadiusMeters={profile.autoIdRadiusMeters}
                onAction={applyAction}
                focusedFeatureId={focusedFeatureId}
                focusRequest={reviewQueueFocusRequest}
                onFocusFeature={setFocusedFeatureId}
              />
            </section>
          ) : (
            <section
              id="review-step"
              className="review-empty glass-background glass-background--level-1"
              aria-labelledby="review-empty-heading"
            >
              <p className="eyebrow">Conflation queue</p>
              <h2 id="review-empty-heading">Review items will appear here</h2>
              <p>
                {stops.length === 0
                  ? "Upload a GTFS ZIP and retrieve OSM candidates to begin comparing stops."
                  : "Retrieve OSM candidates to load the review queue."}
              </p>
            </section>
          )}
        </section>
      </div>
      <IntroWarning
        onContinue={() => document.getElementById("gtfs-files")?.focus()}
      />
    </main>
  );
}

export default App;
