import communityTransitProfileJson from "./US-WA-CT.json";
import everettTransitProfileJson from "./US-WA-ET.json";
import intercityTransitProfileJson from "./US-WA-IT.json";
import kingCountyMetroProfileJson from "./US-WA-KCM.json";
import kitsapTransitProfileJson from "./US-WA-KT.json";
import pierceTransitProfileJson from "./US-WA-PT.json";
import seattleCenterMonorailProfileJson from "./US-WA-SCM.json";
import soundTransitProfileJson from "./US-WA-ST.json";
import washingtonStateFerriesProfileJson from "./US-WA-WSF.json";
import {
  MappingProfile,
  ProfileValidationError,
  validateMappingProfile
} from "../domain/profile";
import {
  CONSOLIDATED_SOURCE_FEED_ID,
  DEFAULT_STREET_NAME_CLEANUP,
  identityTagKey,
  isValidSourceFeedId,
  normalizeSourceFeedId
} from "../domain/source-feed";
import { sha256Hex } from "../domain/session";

const stockProfiles = [
  communityTransitProfileJson,
  everettTransitProfileJson,
  intercityTransitProfileJson,
  kingCountyMetroProfileJson,
  kitsapTransitProfileJson,
  pierceTransitProfileJson,
  seattleCenterMonorailProfileJson,
  soundTransitProfileJson,
  washingtonStateFerriesProfileJson
].map((profile) => validateMappingProfile(profile));

export const PROFILE_DICTIONARY: Readonly<Record<string, MappingProfile>> =
  Object.freeze(
    Object.fromEntries(
      stockProfiles.flatMap((profile) =>
        profile.sourceFeeds.map((sourceFeed) => [
          normalizeSourceFeedId(sourceFeed.id),
          profile
        ])
      )
    )
  );

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

export function getDefaultProfile(): MappingProfile {
  const profile = getProfileForFeedIds(
    stockProfiles.flatMap((stockProfile) =>
      stockProfile.sourceFeeds.map((sourceFeed) => sourceFeed.id)
    )
  );
  if (profile === undefined) {
    throw new Error("The stock profile registry is empty");
  }
  return profile;
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
      enabled: true,
      geometryTarget: "osm",
      streetNameCleanup: DEFAULT_STREET_NAME_CLEANUP,
      additionalTags: []
    })),
    mappingRules: normalizedIds.map((sourceFeedId) => ({
      key: identityTagKey(sourceFeedId),
      value: { kind: "field", field: "stop_id" },
      appliesTo: { sourceFeedIds: [sourceFeedId] }
    })),
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
