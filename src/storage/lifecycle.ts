import { SessionRepository, StagedSession, StoredSession } from "./types";

export async function stageAndActivateSession(
  repository: SessionRepository,
  session: StagedSession
): Promise<void> {
  try {
    await repository.putStagingSession(session);
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
  try {
    const result = await operation();
    await stageAndActivateSession(repository, session);
    return result;
  } catch (error) {
    await repository.deleteSession(session.manifest.sessionId);
    throw error;
  }
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
