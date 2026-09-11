import { describe, expect, it } from "vitest";
import {
  combinedSourceSetFingerprint,
  isCompatibleSession
} from "../../src/domain/session";

describe("session compatibility fingerprints", () => {
  it("sorts source pairs before hashing", async () => {
    const first = await combinedSourceSetFingerprint([
      { sourceFeedId: "US-WA-KCM", archiveFingerprint: "kcm" },
      { sourceFeedId: "US-WA-CT", archiveFingerprint: "ct" }
    ]);
    const reordered = await combinedSourceSetFingerprint([
      { sourceFeedId: "US-WA-CT", archiveFingerprint: "ct" },
      { sourceFeedId: "US-WA-KCM", archiveFingerprint: "kcm" }
    ]);
    const changed = await combinedSourceSetFingerprint([
      { sourceFeedId: "US-WA-CT", archiveFingerprint: "changed" },
      { sourceFeedId: "US-WA-KCM", archiveFingerprint: "kcm" }
    ]);
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("requires all compatibility keys to match", () => {
    const manifest = {
      combinedSourceSetFingerprint: "source",
      mappingProfileFingerprint: "profile",
      osmSnapshotId: "snapshot"
    };
    expect(
      isCompatibleSession(manifest, {
        sourceSetFingerprint: "source",
        mappingProfileFingerprint: "profile",
        osmSnapshotId: "snapshot"
      })
    ).toBe(true);
    expect(
      isCompatibleSession(manifest, {
        sourceSetFingerprint: "source",
        mappingProfileFingerprint: "changed",
        osmSnapshotId: "snapshot"
      })
    ).toBe(false);
  });
});
