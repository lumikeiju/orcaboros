import profileJson from "./puget-sound.json";
import {
  MappingProfile,
  ProfileValidationError,
  validateMappingProfile
} from "../domain/profile";
import {
  CONSOLIDATED_SOURCE_FEED_ID,
  isValidSourceFeedId,
  normalizeSourceFeedId
} from "../domain/source-feed";
import { sha256Hex } from "../domain/session";

export const PugetSoundProfile = validateMappingProfile(profileJson);
export const PUgetSoundProfile = PugetSoundProfile;

function profileForSourceFeed(sourceFeedId: string): MappingProfile {
  const sourceFeed = PugetSoundProfile.sourceFeeds.find(
    (candidate) => normalizeSourceFeedId(candidate.id) === sourceFeedId
  );
  if (sourceFeed === undefined) {
    throw new Error(`No stock profile exists for ${sourceFeedId}`);
  }
  return {
    ...PugetSoundProfile,
    id: `${PugetSoundProfile.id}-${sourceFeedId.toLowerCase()}`,
    name: `${sourceFeed.displayName} mapping profile`,
    sourceFeeds: [sourceFeed]
  };
}

export const PROFILE_DICTIONARY: Readonly<Record<string, MappingProfile>> =
  Object.freeze(
    Object.fromEntries(
      PugetSoundProfile.sourceFeeds.map((sourceFeed) => {
        const sourceFeedId = normalizeSourceFeedId(sourceFeed.id);
        return [sourceFeedId, profileForSourceFeed(sourceFeedId)];
      })
    )
  );

export function getPugetSoundProfile(): MappingProfile {
  return PugetSoundProfile;
}

export function getProfileForFeedId(
  sourceFeedId: string
): MappingProfile | undefined {
  return PROFILE_DICTIONARY[normalizeSourceFeedId(sourceFeedId)];
}

export function getProfileForFeedIds(
  sourceFeedIds: readonly string[]
): MappingProfile | undefined {
  const normalizedIds = [
    ...new Set(
      sourceFeedIds.map((sourceFeedId) => normalizeSourceFeedId(sourceFeedId))
    )
  ];
  if (normalizedIds.length === 0) {
    return undefined;
  }
  const profiles = normalizedIds.map(getProfileForFeedId);
  if (profiles.some((profile) => profile === undefined)) {
    return undefined;
  }
  const matchedProfiles = profiles as MappingProfile[];
  if (matchedProfiles.length === 1) {
    return matchedProfiles[0];
  }
  const mappingRules = matchedProfiles.flatMap(
    (profile) => profile.mappingRules
  );
  const uniqueRules = mappingRules.filter(
    (rule, index) =>
      mappingRules.findIndex(
        (candidate) => JSON.stringify(candidate) === JSON.stringify(rule)
      ) === index
  );
  return {
    ...matchedProfiles[0],
    id: `${matchedProfiles[0].id}-combined`,
    name: `${matchedProfiles.length} feed mapping profiles`,
    sourceFeeds: matchedProfiles.flatMap((profile) => profile.sourceFeeds),
    mappingRules: uniqueRules
  };
}

export function createCustomProfileForFeedIds(
  sourceFeedIds: readonly string[]
): MappingProfile {
  const normalizedIds = [
    ...new Set(
      sourceFeedIds.map((sourceFeedId) => normalizeSourceFeedId(sourceFeedId))
    )
  ];
  if (normalizedIds.length === 0) {
    throw new Error("A custom profile requires at least one feed ID");
  }
  if (
    normalizedIds.some(
      (sourceFeedId) =>
        sourceFeedId === CONSOLIDATED_SOURCE_FEED_ID ||
        !isValidSourceFeedId(sourceFeedId)
    )
  ) {
    throw new Error("A custom profile contains an invalid feed ID");
  }
  return {
    schemaVersion: 1,
    id: `custom-${normalizedIds.join("-").toLowerCase()}`,
    name: "Custom feed mapping",
    version: "1.0.0",
    sourceFeeds: normalizedIds.map((sourceFeedId) => ({
      id: sourceFeedId,
      displayName: sourceFeedId,
      enabled: true
    })),
    mappingRules: [],
    candidateRadiusMeters: 50,
    autoIdRadiusMeters: 10
  };
}

export function parseProfileJson(text: string): MappingProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error: unknown) {
    void error;
    throw new ProfileValidationError([
      { path: "$", message: "must contain valid JSON" }
    ]);
  }
  return validateMappingProfile(parsed);
}

export function serializeProfile(profile: MappingProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

export async function fingerprintProfile(
  profile: MappingProfile
): Promise<string> {
  return sha256Hex(new TextEncoder().encode(serializeProfile(profile)));
}
