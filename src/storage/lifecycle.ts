import { SessionRepository, StagedSession, StoredSession } from "./types";

export async function stageAndActivateSession(
  repository: SessionRepository,
  session: StagedSession
): Promise<void> {
  await repository.putStagingSession(session);
  try {
    await repository.activateStagingSession(session.manifest.sessionId);
  } catch (error) {
    await repository.deleteSession(session.manifest.sessionId);
    throw error;
  }
}

export async function preserveActiveSessionOnFailure<T>(
  repository: SessionRepository,
  session: StagedSession,
  operation: () => Promise<T>
): Promise<T> {
  const result = await operation();
  await stageAndActivateSession(repository, session);
  return result;
}

export function invalidateSessionArtifacts(
  session: StoredSession,
  reason: "source-set" | "profile" | "snapshot"
): StoredSession {
  if (reason === "snapshot") {
    return { ...session, reviews: undefined, draft: undefined };
  }
  return {
    ...session,
    osmSnapshot: undefined,
    reviews: undefined,
    draft: undefined,
    manifest: {
      ...session.manifest,
      osmSnapshotId: undefined,
      osmSnapshotTimestamp: undefined,
      osmSnapshotBounds: undefined,
      reviewStateVersion: session.manifest.reviewStateVersion + 1,
      draftVersion: session.manifest.draftVersion + 1
    }
  };
}
