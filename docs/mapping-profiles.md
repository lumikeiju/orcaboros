# Mapping profiles

A mapping profile is versioned JSON. It declares source-feed identities, OSM tag rules, and matching radii. The browser builds a profile dictionary keyed by normalized feed ID from the stock profile definitions in `src/profiles/`. When an editable feed ID in the upload step matches a dictionary entry, that feed's profile becomes active automatically. Profiles remain out of the workflow until a feed matches them.

The active profile can still be exported or imported as JSON. A rule cannot contain code, templates, arbitrary filters, or Overpass QL.

## Source feeds

The stock profile dictionary contains one profile for each of the nine individual Puget Sound archives. Each profile is stored as `src/profiles/FEED.json`, using the feed ID as the filename:

`US-WA-CT`, `US-WA-ET`, `US-WA-IT`, `US-WA-KCM`, `US-WA-KT`, `US-WA-PT`, `US-WA-SCM`, `US-WA-ST`, and `US-WA-WSF`.

For example, the King County Metro profile is [`src/profiles/US-WA-KCM.json`](../src/profiles/US-WA-KCM.json).

The consolidated `US-WA-PSC` feed is rejected before profile lookup and is also invalid in custom profile JSON. A selected filename such as `US-WA-KCM.zip` derives the identity `US-WA-KCM`; the importer never infers ownership from `agency.txt` or another schedule file. Multiple known feeds use one active profile containing the selected source definitions.

An otherwise valid feed ID without a dictionary entry receives a blank custom profile for the current session, so its mappings must be defined explicitly. This does not add the ID to the stock dictionary.

## Direct fields

The importer records every header in the uploaded `stops.txt` file and the profile editor renders those headers as an editable field-to-OSM-tag table. A field row with a blank OSM key is ignored. A rule may reference any safe GTFS header, as well as the computed fields `stop_name_expanded`, `source_feed_id`, and `source_feed_name`; empty field values omit a proposed tag. After import, each field row includes a read-only example using a randomly selected source row from the middle 50% of the file. Stock and newly created custom profiles include a source-scoped `stop_id` mapping to `gtfs:stop_id:<SOURCE_FEED_ID>`. Single-feed profiles show that mapping in the direct field table; multi-feed profiles retain one source-scoped mapping per feed. Evaluation also guarantees that every eligible feature receives its source identity tag, including profiles imported from older JSON.

Each stock profile maps the GTFS `stop_name` to the OSM `name` tag. The `sourceFeeds` entry owns an `additionalTags` array for feed-specific constant, field, and source-metadata rules; stock profiles use it for `public_transport=platform` and `highway=bus_stop` on platforms. The profile editor renders and edits this array inside the corresponding feed card, so changes to one feed do not affect another feed in a combined profile. Unrelated OSM tags are preserved. A differing value defaults to `keep-current`; replacing it requires an explicit review action.

Profiles imported from the earlier schema may still put non-direct rules in the top-level `mappingRules` array. Validation migrates those legacy rules into `sourceFeeds[].additionalTags` using their existing source-feed applicability, while retaining direct GTFS field mappings at the top level.

Each source feed also has a `geometryTarget` setting. `osm` (the default) keeps a selected OSM node at its snapshot location and applies the reviewed GTFS tag changes to that node. `gtfs` keeps the selected OSM node ID and version but writes the GTFS stop coordinates in the OSM Change modification, moving the existing element instead of creating a replacement. New stops selected for creation are always created at their GTFS coordinates. If multiple selected stops share an OSM node, their target coordinates must agree before an export can be generated.

## Validation

Profile JSON is validated before import. Source IDs, geometry targets, mapping keys, tag values, applicability values, radii, duplicate source IDs, and the schema version are checked. Profiles imported without `geometryTarget` use the backwards-compatible `osm` default. Candidate radius defaults to 50 m and the exact identity auto-match radius defaults to 10 m. Custom profiles may change those values only within the safe bounded range enforced by `validateMappingProfile`.
