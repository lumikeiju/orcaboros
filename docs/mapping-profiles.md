# Mapping profiles

A mapping profile is versioned JSON. It declares source-feed identities, OSM tag rules, and matching radii. The browser builds a profile dictionary keyed by normalized feed ID from the stock profile definitions in `src/profiles/`. When an editable feed ID in the upload step matches a dictionary entry, that feed's profile becomes active automatically. Profiles remain out of the workflow until a feed matches them.

The active profile can still be exported or imported as JSON. A rule cannot contain code, templates, arbitrary filters, or Overpass QL.

## Source feeds

The stock profile dictionary contains entries for the nine individual Puget Sound archives:

`US-WA-CT`, `US-WA-ET`, `US-WA-IT`, `US-WA-KCM`, `US-WA-KT`, `US-WA-PT`, `US-WA-SCM`, `US-WA-ST`, and `US-WA-WSF`.

The consolidated `US-WA-PSC` feed is rejected before profile lookup and is also invalid in custom profile JSON. A selected filename such as `US-WA-KCM.zip` derives the identity `US-WA-KCM`; the importer never infers ownership from `agency.txt` or another schedule file. Multiple known feeds use one active profile containing the selected source definitions.

An otherwise valid feed ID without a dictionary entry receives a blank custom profile for the current session, so its mappings must be defined explicitly. This does not add the ID to the stock dictionary.

## Direct fields

The importer records every header in the uploaded `stops.txt` file and the profile editor renders those headers as an editable field-to-OSM-tag table. A field row with a blank OSM key is ignored. A rule may reference any safe GTFS header, as well as the computed fields `stop_name_expanded`, `source_feed_id`, and `source_feed_name`; empty field values omit a proposed tag. Every eligible feature receives the generated identity tag `gtfs:stop_id:<SOURCE_FEED_ID>=<stop_id>` in addition to profile rules.

The supplied profile maps the expanded name, a location-specific `public_transport` value, and `highway=bus_stop` for platforms. Conditional and constant rules remain editable below the uploaded-field table. Unrelated OSM tags are preserved. A differing value defaults to `keep-current`; replacing it requires an explicit review action.

## Validation

Profile JSON is validated before import. Source IDs, mapping keys, tag values, applicability values, radii, duplicate source IDs, and the schema version are checked. Candidate radius defaults to 50 m and the exact identity auto-match radius defaults to 10 m. Custom profiles may change those values only within the safe bounded range enforced by `validateMappingProfile`.
