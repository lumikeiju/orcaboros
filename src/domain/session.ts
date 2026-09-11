import { lexicalCompare } from "./order";

export type SourceArchiveFingerprint = {
  sourceFeedId: string;
  archiveFingerprint: string;
};

export type SessionManifest = {
  sessionId: string;
  schemaVersion: 1;
  createdAt: string;
  sourceFeedIds: readonly string[];
  sourceArchiveFingerprints: readonly SourceArchiveFingerprint[];
  combinedSourceSetFingerprint: string;
  eligibleStopDatasetVersion: string;
  mappingProfileSchemaVersion: number;
  mappingProfileFingerprint: string;
  osmSnapshotId: string | undefined;
  osmSnapshotTimestamp: string | undefined;
  osmSnapshotBounds:
    | {
        south: number;
        west: number;
        north: number;
        east: number;
      }
    | undefined;
  reviewStateVersion: number;
  draftVersion: number;
};

export type SessionCompatibility = {
  sourceSetFingerprint: string;
  mappingProfileFingerprint: string;
  osmSnapshotId: string;
};

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const digest = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function combinedSourceSetFingerprint(
  pairs: readonly SourceArchiveFingerprint[]
): Promise<string> {
  const canonical = [...pairs]
    .sort((left, right) =>
      lexicalCompare(left.sourceFeedId, right.sourceFeedId)
    )
    .map(
      (pair) =>
        `${pair.sourceFeedId.trim().toUpperCase()}\u0000${pair.archiveFingerprint}`
    )
    .join("\n");
  return sha256Hex(new TextEncoder().encode(canonical));
}

export function isCompatibleSession(
  manifest: Pick<
    SessionManifest,
    | "combinedSourceSetFingerprint"
    | "mappingProfileFingerprint"
    | "osmSnapshotId"
  >,
  compatibility: SessionCompatibility
): boolean {
  return (
    manifest.combinedSourceSetFingerprint ===
      compatibility.sourceSetFingerprint &&
    manifest.mappingProfileFingerprint ===
      compatibility.mappingProfileFingerprint &&
    manifest.osmSnapshotId === compatibility.osmSnapshotId
  );
}
