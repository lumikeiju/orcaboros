import { EligibleStop } from "../../domain/gtfs";
import { evaluateMappingRules, MappingProfile } from "../../domain/profile";
import { OsmTagSet, tagArrayToRecord } from "../../domain/osm";

export function mapStopToOsmTags(
  profile: MappingProfile,
  stop: EligibleStop
): OsmTagSet {
  return tagArrayToRecord(evaluateMappingRules(profile, stop));
}
