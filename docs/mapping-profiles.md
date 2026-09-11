# Mapping profiles

A mapping profile is versioned JSON. It declares enabled source-feed identities, direct OSM tag rules, and matching radii. A rule is either a constant or one of the supported GTFS/source fields; it cannot contain code, templates, arbitrary filters, or Overpass QL.

## Source feeds

The stock profile accepts the nine individual Puget Sound archives:

`US-WA-CT`, `US-WA-ET`, `US-WA-IT`, `US-WA-KCM`, `US-WA-KT`, `US-WA-PT`, `US-WA-SCM`, `US-WA-ST`, and `US-WA-WSF`.

The consolidated `US-WA-PSC` feed is rejected before profile lookup and is also invalid in custom profile JSON. A selected filename such as `US-WA-KCM.zip` derives the identity `US-WA-KCM`; the importer never infers ownership from `agency.txt` or another schedule file.

## Direct fields

Supported fields are `stop_id`, `stop_name`, `stop_name_expanded`, `stop_lat`, `stop_lon`, `location_type`, `parent_station`, `source_feed_id`, and `source_feed_name`. Empty field values omit a proposed tag. Every eligible feature receives the generated identity tag `gtfs:stop_id:<SOURCE_FEED_ID>=<stop_id>` in addition to profile rules.

The supplied profile maps the expanded name, a location-specific `public_transport` value, and `highway=bus_stop` for platforms. Unrelated OSM tags are preserved. A differing value defaults to `keep-current`; replacing it requires an explicit review action.

## Validation

Profile JSON is validated before import. Source IDs, mapping keys, tag values, applicability values, radii, duplicate source IDs, and the schema version are checked. Candidate radius defaults to 50 m and the exact identity auto-match radius defaults to 10 m. Custom profiles may change those values only within the safe bounded range enforced by `validateMappingProfile`.
