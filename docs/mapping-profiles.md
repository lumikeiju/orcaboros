# Mapping profiles

A schema-v1 JSON profile defines source feeds, OSM tag rules, name and geometry settings, and matching radii. Import or export the active profile in the editor. Rules are data only: they cannot contain code, templates, arbitrary filters, or Overpass QL.

## Feed selection and input

- Stock profiles cover a set of feeds. Each is `src/profiles/<FEED_ID>.json`; for example, [King County Metro (US-WA-KCM.json)](../src/profiles/US-WA-KCM.json).
- A feed ID defaults to the ZIP filename and can be edited in the upload step; it is never inferred from `agency.txt` or another schedule file. If every selected ID has a stock profile, those profiles are combined and their feed sections start collapsed with an “Auto-matched” label; users can expand them to inspect or edit the mappings. Otherwise the app creates a blank custom profile for the selected feeds. Custom IDs do not enter the stock registry. Consolidated feed `US-WA-PSC` is rejected.
- Only local `stops.txt` is read. It requires `stop_id`, `stop_name`, `stop_lat`, and `stop_lon`; blank or `0` `location_type` means platform, and `1` means station. Unsupported or invalid rows are skipped with diagnostics; duplicate stop IDs fail that feed's import.

## Mapping and review

- `mappingRules` maps any `stops.txt` header or computed field (including `stop_name_expanded`, `source_feed_id`, and `source_feed_name`) to an OSM key. Values can be constants, fields, or source metadata; `appliesTo` can limit a rule by feed or location kind. Empty values are omitted, and profile validation checks keys and values.
- Every stock profile maps `stop_name_expanded` to `name` and maps `stop_code` to `gtfs:stop_code:<FEED_ID>`. Street-name cleanup is enabled by default; it capitalizes all-uppercase names and expands supported US street abbreviations and directions. Raw `stop_name` remains available. Changing profile settings reprocesses stops and invalidates candidates and review state.
- `stop_id` is not mapped. OSM identity tags (`gtfs:stop_id:<FEED_ID>`) can help find and match existing features. Stock profiles propose removing `gtfs:stop_id`, `gtfs:stop_id:<FEED_ID>`, and `gtfs:feed` from matched elements; the feed-specific stop-code tag is preserved instead.
- Per-feed `additionalTags` supports constants, fields, and source metadata; stock profiles use it for `public_transport=platform` and `highway=bus_stop` on platforms. Per-feed `removeKeys` proposes reviewable removals from matched elements only; an active GTFS mapping takes precedence, and new elements are unaffected. Unmapped OSM tags are preserved, and differing values default to keeping the current value until explicitly changed.

## Geometry and defaults

- `geometryTarget: "osm"` (default) preserves a selected OSM element's location. `"gtfs"` moves selected nodes to the GTFS coordinates; platform ways always retain their member geometry, using their center only for matching. New elements use GTFS coordinates. If stops sharing an OSM element require different coordinates, export is blocked.
- Candidate and exact-identity auto-match radii default to 50 m and 10 m. Each must be greater than 0 and at most 10,000 m; the auto-match radius cannot exceed the candidate radius.
- For older profiles, missing `geometryTarget`, `streetNameCleanup`, and `removeKeys` default to `"osm"`, enabled, and empty. Legacy non-direct rules in `mappingRules` migrate to the applicable feed's `additionalTags`.
