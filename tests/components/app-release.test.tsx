import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { Blob as NodeBlob } from "node:buffer";
import { createEligibleStop, type EligibleStop } from "../../src/domain/gtfs";
import { buildTagProposals, type FeatureReview } from "../../src/domain/review";
import { evaluateRemovalKeys } from "../../src/domain/profile";
import type { OsmElement } from "../../src/domain/osm";
import { mapStopToOsmTags } from "../../src/infrastructure/gtfs";
import { matchStops } from "../../src/infrastructure/osm/matching";
import { getProfileForFeedIds } from "../../src/profiles";
import { MemorySessionRepository } from "../../src/storage/memory";
import { buildStagedSession } from "../../src/storage/session-builder";
import type { SessionRepository, StoredSession } from "../../src/storage/types";

const mocks = vi.hoisted(() => ({
  importArchive: vi.fn(),
  match: vi.fn(),
  download: vi.fn()
}));
const storage = vi.hoisted(() => {
  const state: { repository?: SessionRepository } = {};
  return state;
});

vi.mock("../../src/components/MapView", () => ({ MapView: () => null }));
vi.mock("../../src/features/import/worker-client", () => ({
  startArchiveImport: mocks.importArchive
}));
vi.mock("../../src/features/matching/worker-client", () => ({
  matchStopsInWorker: mocks.match
}));
vi.mock(
  "../../src/infrastructure/browser/download",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../src/infrastructure/browser/download")
    >()),
    downloadTextFile: mocks.download
  })
);
vi.mock("../../src/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/storage")>()),
  MemorySessionRepository: vi.fn(function () {
    if (storage.repository === undefined) {
      throw new Error("Missing test repository");
    }
    return storage.repository;
  })
}));

let repository: MemorySessionRepository;

beforeEach(() => {
  repository = new MemorySessionRepository();
  storage.repository = repository;
  mocks.match.mockImplementation(
    async (
      stops: readonly EligibleStop[],
      nodes: readonly OsmElement[],
      candidateRadius: number,
      autoRadius: number
    ) => matchStops(stops, nodes, candidateRadius, autoRadius)
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  mocks.importArchive.mockReset();
  mocks.match.mockReset();
  mocks.download.mockReset();
});

function fixtureStop(
  sourceFeedId = "US-WA-KCM",
  name = "MAIN ST"
): EligibleStop {
  const parsed = createEligibleStop(sourceFeedId, sourceFeedId, {
    rowNumber: 2,
    fields: {
      stop_id: "1",
      stop_code: "CODE",
      stop_name: name,
      stop_lat: "47",
      stop_lon: "-122"
    }
  });
  if (!("stop" in parsed)) {
    throw new Error("Invalid test stop");
  }
  return parsed.stop;
}

const node = {
  id: 42,
  version: 7,
  latitude: 47,
  longitude: -122,
  tags: { name: "Existing OSM name", "gtfs:stop_id": "1", highway: "bus_stop" }
};

async function seedSession(
  stops: readonly EligibleStop[] = [fixtureStop()],
  selected = false,
  acceptNames = false
): Promise<StoredSession> {
  const profile = getProfileForFeedIds(stops.map((stop) => stop.sourceFeedId));
  if (profile === undefined) {
    throw new Error("Missing stock profile");
  }
  const staged = await buildStagedSession(
    "release-session",
    profile,
    stops.map((stop) => ({
      sourceFeedId: stop.sourceFeedId,
      archiveFingerprint: "0".repeat(64),
      result: {
        sourceFeedId: stop.sourceFeedId,
        sourceFeedName: stop.sourceFeedName,
        fields: Object.keys(stop.rawFields),
        eligibleStops: [stop],
        validStopIds: new Set([stop.stopId]),
        diagnostics: [],
        counts: {
          totalRows: 1,
          eligibleRows: 1,
          skippedRows: 0,
          invalidRows: 0,
          unsupportedLocationRows: 0
        }
      }
    }))
  );
  await repository.putStagingSession(staged);
  await repository.activateStagingSession(staged.manifest.sessionId);
  const reviews: FeatureReview[] = stops.map((stop) => ({
    featureId: stop.featureId,
    state: selected ? "match-selected" : "unreviewed",
    selectedNodeId: selected ? node.id : undefined,
    createCoordinates: undefined,
    proposals: buildTagProposals(
      selected ? node : undefined,
      mapStopToOsmTags(profile, stop),
      [],
      evaluateRemovalKeys(profile, stop)
    ).map((proposal) =>
      acceptNames && proposal.key === "name"
        ? { ...proposal, resolution: "accept-proposed" }
        : proposal
    )
  }));
  const session: StoredSession = {
    ...staged,
    osmSnapshot: {
      snapshotId: "release-snapshot",
      timestamp: "2026-10-25T12:00:00.000Z",
      bounds: { south: 46.9, west: -122.1, north: 47.1, east: -121.9 },
      nodes: [node]
    },
    reviews,
    manifest: { ...staged.manifest, osmSnapshotId: "release-snapshot" }
  };
  await repository.putActiveSession(session);
  const saved = await repository.getActiveSession();
  if (saved === undefined) {
    throw new Error("The fixture session was not saved");
  }
  return saved;
}

async function renderRestoredApp(count = 1): Promise<void> {
  render(<App />);
  fireEvent.click(
    screen.getByRole("button", { name: /I have read these warnings/ })
  );
  await screen.findByText(
    `Restored ${count} eligible stops from the active session.`
  );
}

function openStep(
  label: "Upload" | "Profile" | "Retrieve" | "Review" | "Export"
): void {
  fireEvent.click(
    screen.getByRole("button", { name: new RegExp(`\\d ${label} `) })
  );
}

async function exportChanges(): Promise<void> {
  openStep("Export");
  fireEvent.click(
    screen.getByRole("button", { name: "Download JOSM OSM File" })
  );
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Download JOSM OSM File" })
    ).not.toBeDisabled()
  );
}

describe("release workflow regressions", () => {
  it("refreshes source metadata when a compatible profile is imported", async () => {
    const session = await seedSession();
    await renderRestoredApp();
    openStep("Profile");
    const nextProfile = {
      ...session.profile,
      sourceFeeds: session.profile.sourceFeeds.map((sourceFeed) => ({
        ...sourceFeed,
        metadata: { operator: "Updated operator" },
        additionalTags: [
          ...(sourceFeed.additionalTags ?? []),
          {
            key: "operator",
            value: { kind: "source-metadata", key: "operator" }
          }
        ]
      }))
    };
    const file = Object.assign(new NodeBlob([JSON.stringify(nextProfile)]), {
      name: "profile.json"
    });
    fireEvent.change(screen.getByLabelText("Import profile JSON"), {
      target: { files: [file] }
    });
    await waitFor(async () => {
      const saved = await repository.getActiveSession();
      expect(
        saved?.sourceFeeds[0]?.eligibleStops[0]?.sourceFeedMetadata
      ).toEqual({ operator: "Updated operator" });
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("rejects a profile that drops an imported feed without invalidating its session", async () => {
    const session = await seedSession();
    await renderRestoredApp();
    openStep("Profile");
    const otherProfile = getProfileForFeedIds(["US-WA-ST"]);
    const file = Object.assign(new NodeBlob([JSON.stringify(otherProfile)]), {
      name: "other-profile.json"
    });
    fireEvent.change(screen.getByLabelText("Import profile JSON"), {
      target: { files: [file] }
    });
    await screen.findByText(
      "The profile must enable every imported source feed."
    );
    expect(await repository.getActiveSession()).toEqual(session);
  });

  it("commits the current profile with a successful snapshot after a previous profile save failed", async () => {
    await seedSession();
    await renderRestoredApp();
    const save = repository.putActiveSession.bind(repository);
    const saveSpy = vi.spyOn(repository, "putActiveSession");
    saveSpy.mockRejectedValueOnce(new Error("Temporary storage failure"));
    saveSpy.mockImplementation(save);
    openStep("Profile");
    fireEvent.change(screen.getByLabelText("Candidate radius (m)"), {
      target: { value: "100" }
    });
    await screen.findByText("Temporary storage failure");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ elements: [] })))
    );
    openStep("Retrieve");
    fireEvent.change(
      screen.getByLabelText("HTTPS Overpass-compatible endpoint"),
      { target: { value: "https://example.test/api" } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retrieve Candidates" })
    );
    await screen.findByRole("button", { name: "Continue to review" });
    const saved = await repository.getActiveSession();
    expect(saved?.profile.candidateRadiusMeters).toBe(100);
    expect(saved?.osmSnapshot?.snapshotId).not.toBe("release-snapshot");
  });

  it("rebuilds candidate evidence when restoring a snapshot", async () => {
    await seedSession();
    await renderRestoredApp();
    openStep("Review");
    const comparison = screen.getByRole("region", { name: "Comparison" });
    expect(
      within(comparison).getByRole("table", {
        name: "GTFS-mapped tags on the left and OSM tags on the right"
      })
    ).toHaveTextContent("Existing OSM name");
    expect(
      screen.getByRole("button", { name: "Accept match" })
    ).toBeInTheDocument();
  });

  it("preserves the active session while selecting and cancelling replacement archives", async () => {
    const session = await seedSession([fixtureStop()], true);
    await renderRestoredApp();
    openStep("Upload");
    fireEvent.change(screen.getByLabelText("Choose or drop GTFS ZIPs"), {
      target: { files: [new File([], "US-WA-ST.zip")] }
    });
    expect(await repository.getActiveSession()).toEqual(session);
    mocks.importArchive.mockReturnValue({
      promise: Promise.reject(new DOMException("Cancelled", "AbortError")),
      cancel: vi.fn()
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Process selected GTFS ZIPs" })
    );
    await screen.findAllByText(
      "Import cancelled. The previous active session remains unchanged."
    );
    expect(await repository.getActiveSession()).toEqual(session);
    expect(
      screen.getByRole("button", { name: /3 Retrieve .* Retrieved/ })
    ).toBeInTheDocument();
  });

  it.each(["keep-current", "remove"] as const)(
    "honors saved name and legacy-tag decisions at export: %s",
    async (resolution) => {
      const session = await seedSession([fixtureStop()], true);
      if (session.reviews === undefined) {
        throw new Error("Missing saved tag decisions");
      }
      await repository.putActiveSession({
        ...session,
        reviews: session.reviews.map((review) => ({
          ...review,
          proposals: review.proposals.map((proposal) => ({
            ...proposal,
            resolution:
              proposal.key === "name"
                ? resolution
                : proposal.key === "gtfs:stop_id"
                  ? "keep-current"
                  : proposal.resolution
          }))
        }))
      });
      await renderRestoredApp();
      await exportChanges();

      expect(mocks.download).toHaveBeenCalledOnce();
      const xml: string = mocks.download.mock.calls[0]?.[0];
      expect(xml).toContain('k="gtfs:stop_id" v="1"');
      if (resolution === "keep-current") {
        expect(xml).toContain('k="name" v="Existing OSM name"');
      } else {
        expect(xml).not.toContain('k="name"');
      }
      expect((await repository.getActiveSession())?.draft).toMatchObject({
        sessionId: "release-session",
        snapshotId: "release-snapshot"
      });
    }
  );

  it("blocks conflicting tag decisions for one element shared by feeds", async () => {
    await seedSession(
      [fixtureStop(), fixtureStop("US-WA-ST", "SECOND ST")],
      true,
      true
    );
    await renderRestoredApp(2);
    await exportChanges();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "conflicting tag decisions for name"
    );
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("identifies invalid tag values and focuses affected review items", async () => {
    const stop = fixtureStop();
    const session = await seedSession([stop], true);
    if (session.reviews === undefined) {
      throw new Error("Missing test reviews");
    }
    const reviews = session.reviews.map((review) => ({
      ...review,
      proposals: review.proposals.map((proposal) =>
        proposal.key === "name"
          ? {
              ...proposal,
              proposedValue: "Invalid\u0001name",
              resolution: "accept-proposed" as const
            }
          : proposal
      )
    }));
    await repository.putActiveSession({ ...session, reviews });
    await renderRestoredApp();

    await exportChanges();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "OSM Change export is invalid (1 issue)"
    );
    expect(
      screen.getByText('Value for tag "name" is not a valid OSM string.')
    ).toBeInTheDocument();
    const reviewStep = document.getElementById("review-step");
    if (reviewStep === null) {
      throw new Error("Missing review step");
    }
    Object.defineProperty(reviewStep, "scrollIntoView", {
      configurable: true,
      value: vi.fn()
    });
    fireEvent.click(
      screen.getByRole("link", {
        name: /Focus .*US-WA-KCM; Stop code: CODE/
      })
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: `Focus ${stop.stopNameExpanded} on the map`
        })
      ).toHaveFocus()
    );
  });

  it("does not download when storing the export fails", async () => {
    await seedSession([fixtureStop()], true);
    await renderRestoredApp();
    vi.spyOn(repository, "putActiveSession").mockRejectedValue(
      new Error("Simulated quota failure")
    );
    await exportChanges();
    expect(
      screen
        .getAllByRole("alert")
        .some((alert) => alert.textContent?.includes("Simulated quota failure"))
    ).toBe(true);
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it("reports duplicate live mappings without crashing or changing the active profile", async () => {
    const session = await seedSession();
    await renderRestoredApp();
    openStep("Profile");
    fireEvent.change(screen.getByLabelText("OSM tag key for stop_code"), {
      target: { value: "name" }
    });
    expect(screen.getByRole("alert")).toHaveTextContent("duplicate key: name");
    expect(screen.getByLabelText("OSM tag key for stop_code")).toHaveValue(
      "gtfs:stop_code:US-WA-KCM"
    );
    expect((await repository.getActiveSession())?.profile).toEqual(
      session.profile
    );
  });

  it("preserves reviewed data when a refresh returns an Overpass runtime error", async () => {
    const session = await seedSession([fixtureStop()], true);
    await renderRestoredApp();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ elements: [], remark: "runtime error" })
          )
        )
    );
    openStep("Retrieve");
    fireEvent.change(
      screen.getByLabelText("HTTPS Overpass-compatible endpoint"),
      { target: { value: "https://example.test/api" } }
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retrieve Candidates" })
    );
    await screen.findByText(/incomplete query result/);
    expect(await repository.getActiveSession()).toEqual(session);
    expect(
      screen.getByRole("button", { name: "Continue to review" })
    ).toBeInTheDocument();
  });

  it("serializes profile writes so an older edit cannot overwrite a newer one", async () => {
    await seedSession();
    await renderRestoredApp();
    const save = repository.putActiveSession.bind(repository);
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const saveSpy = vi.spyOn(repository, "putActiveSession");
    saveSpy.mockImplementationOnce(async (session) => {
      await gate;
      await save(session);
    });
    saveSpy.mockImplementation(save);
    openStep("Profile");
    fireEvent.change(screen.getByLabelText("Candidate radius (m)"), {
      target: { value: "100" }
    });
    await waitFor(() => expect(saveSpy).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Auto-match radius"), {
      target: { value: "20" }
    });
    expect(saveSpy).toHaveBeenCalledTimes(1);
    if (release === undefined) {
      throw new Error("Missing write gate");
    }
    release();
    await waitFor(async () => {
      expect((await repository.getActiveSession())?.profile).toMatchObject({
        candidateRadiusMeters: 100,
        autoIdRadiusMeters: 20
      });
    });
  });
});
