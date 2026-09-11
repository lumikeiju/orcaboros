import { ImportedArchive } from "../infrastructure/gtfs/importer";
import { MappingProfile } from "../domain/profile";
import {
  combinedSourceSetFingerprint,
  SessionManifest
} from "../domain/session";
import { fingerprintProfile } from "../profiles";
import { validateSourceFeedSelection } from "../domain/source-feed";
import { lexicalCompare } from "../domain/order";
import { StagedSession, StoredSourceFeed } from "./types";

export async function buildStagedSession(
  sessionId: string,
  profile: MappingProfile,
  imported: readonly ImportedArchive[],
  now = new Date()
): Promise<StagedSession> {
  if (sessionId.trim().length === 0 || imported.length === 0) {
    throw new Error(
      "A staged session requires an ID and at least one imported feed"
    );
  }
  const importedIds = imported.map((item) => item.sourceFeedId);
  if (new Set(importedIds).size !== importedIds.length) {
    throw new Error(
      "A staged session cannot contain duplicate source-feed IDs"
    );
  }
  if (
    validateSourceFeedSelection(importedIds, profile.sourceFeeds).length > 0
  ) {
    throw new Error(
      "A staged session contains a source feed outside the profile"
    );
  }
  const sourceArchiveFingerprints = imported
    .map((item) => ({
      sourceFeedId: item.sourceFeedId,
      archiveFingerprint: item.archiveFingerprint
    }))
    .sort((left, right) =>
      lexicalCompare(left.sourceFeedId, right.sourceFeedId)
    );
  const [combinedFingerprint, profileFingerprint] = await Promise.all([
    combinedSourceSetFingerprint(sourceArchiveFingerprints),
    fingerprintProfile(profile)
  ]);
  const sourceFeeds: StoredSourceFeed[] = [...imported]
    .sort((left, right) =>
      lexicalCompare(left.sourceFeedId, right.sourceFeedId)
    )
    .map((item) => ({
      sourceFeedId: item.result.sourceFeedId,
      archiveFingerprint: item.archiveFingerprint,
      sourceFeedName: item.result.sourceFeedName,
      eligibleStops: item.result.eligibleStops,
      validStopIds: [...item.result.validStopIds].sort(),
      diagnostics: item.result.diagnostics,
      counts: item.result.counts
    }));
  const manifest: SessionManifest = {
    sessionId,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    sourceFeedIds: sourceFeeds.map((source) => source.sourceFeedId).sort(),
    sourceArchiveFingerprints,
    combinedSourceSetFingerprint: combinedFingerprint,
    eligibleStopDatasetVersion: "eligible-stops-v1",
    mappingProfileSchemaVersion: profile.schemaVersion,
    mappingProfileFingerprint: profileFingerprint,
    osmSnapshotId: undefined,
    osmSnapshotTimestamp: undefined,
    osmSnapshotBounds: undefined,
    reviewStateVersion: 1,
    draftVersion: 1
  };
  return {
    status: "staging",
    manifest,
    profile,
    sourceFeeds,
    osmSnapshot: undefined,
    reviews: undefined,
    draft: undefined
  };
}
