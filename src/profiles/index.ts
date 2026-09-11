import profileJson from "./puget-sound.json";
import {
  MappingProfile,
  ProfileValidationError,
  validateMappingProfile
} from "../domain/profile";
import { sha256Hex } from "../domain/session";

export const PugetSoundProfile = validateMappingProfile(profileJson);
export const PUgetSoundProfile = PugetSoundProfile;

export function getPugetSoundProfile(): MappingProfile {
  return PugetSoundProfile;
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
