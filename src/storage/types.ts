import { ChangeDraft } from "../domain/change";
import { FeedImportResult, EligibleStop } from "../domain/gtfs";
import { MappingProfile } from "../domain/profile";
import { OsmNode, BoundingBox } from "../domain/osm";
import { FeatureReview } from "../domain/review";
import { SessionManifest } from "../domain/session";

export type StoredSourceFeed = {
  sourceFeedId: string;
  archiveFingerprint: string;
  sourceFeedName: string;
  fields: readonly string[];
  eligibleStops: readonly EligibleStop[];
  validStopIds: readonly string[];
  diagnostics: FeedImportResult["diagnostics"];
  counts: FeedImportResult["counts"];
};

export type StoredOsmSnapshot = {
  snapshotId: string;
  timestamp: string;
  bounds: BoundingBox;
  nodes: readonly OsmNode[];
};

export type StoredSession = {
  manifest: SessionManifest;
  profile: MappingProfile;
  sourceFeeds: readonly StoredSourceFeed[];
  osmSnapshot: StoredOsmSnapshot | undefined;
  reviews: readonly FeatureReview[] | undefined;
  draft: ChangeDraft | undefined;
};

export type StagedSession = StoredSession & {
  status: "staging";
};

export interface SessionRepository {
  getActiveSessionId(): Promise<string | undefined>;
  getActiveSession(): Promise<StoredSession | undefined>;
  getSession(sessionId: string): Promise<StoredSession | undefined>;
  putStagingSession(session: StagedSession): Promise<void>;
  activateStagingSession(sessionId: string): Promise<void>;
  putActiveSession(session: StoredSession): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  resetActiveSession(): Promise<void>;
}
