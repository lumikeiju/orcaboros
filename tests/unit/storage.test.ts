import { describe, expect, it } from "vitest";
import { MemorySessionRepository } from "../../src/storage/memory";
import {
  preserveActiveSessionOnFailure,
  stageAndActivateSession
} from "../../src/storage/lifecycle";
import { StagedSession } from "../../src/storage/types";

const session: StagedSession = {
  status: "staging",
  manifest: {
    sessionId: "session-1",
    schemaVersion: 1,
    createdAt: "2026-09-10T00:00:00.000Z",
    sourceFeedIds: ["US-WA-KCM"],
    sourceArchiveFingerprints: [
      { sourceFeedId: "US-WA-KCM", archiveFingerprint: "abc" }
    ],
    combinedSourceSetFingerprint: "source",
    eligibleStopDatasetVersion: "1",
    mappingProfileSchemaVersion: 1,
    mappingProfileFingerprint: "profile",
    osmSnapshotId: undefined,
    osmSnapshotTimestamp: undefined,
    osmSnapshotBounds: undefined,
    reviewStateVersion: 1,
    draftVersion: 1
  },
  profile: {
    schemaVersion: 1,
    id: "test",
    name: "Test",
    version: "1.0.0",
    sourceFeeds: [
      {
        id: "US-WA-KCM",
        displayName: "KCM",
        enabled: true,
        geometryTarget: "osm",
        streetNameCleanup: true
      }
    ],
    mappingRules: [],
    candidateRadiusMeters: 50,
    autoIdRadiusMeters: 10
  },
  sourceFeeds: [],
  osmSnapshot: undefined,
  reviews: undefined,
  draft: undefined
};

describe("atomic in-memory session lifecycle", () => {
  it("does not delete an existing session when its staging ID collides", async () => {
    const repository = new MemorySessionRepository();
    await stageAndActivateSession(repository, session);
    const original = await repository.getActiveSession();
    await expect(stageAndActivateSession(repository, session)).rejects.toThrow(
      "already exists"
    );
    expect(await repository.getActiveSession()).toEqual(original);
    await expect(
      preserveActiveSessionOnFailure(repository, session, async () => {
        throw new Error("cancelled before staging");
      })
    ).rejects.toThrow("cancelled before staging");
    expect(await repository.getActiveSession()).toEqual(original);
  });

  it("does not replace the active session when staging fails", async () => {
    const repository = new MemorySessionRepository();
    await stageAndActivateSession(repository, session);
    await expect(
      preserveActiveSessionOnFailure(
        repository,
        {
          ...session,
          manifest: { ...session.manifest, sessionId: "session-2" }
        },
        async () => {
          throw new Error("cancelled");
        }
      )
    ).rejects.toThrow();
    expect(await repository.getActiveSessionId()).toBe("session-1");
  });

  it("does not persist an endpoint URL in the session shape", () => {
    expect(JSON.stringify(session)).not.toContain("endpoint");
  });
});
