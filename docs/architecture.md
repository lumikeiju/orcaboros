# Orcaboros architecture

Orcaboros is a static React/Vite application. The browser is the only runtime; there is no application server, proxy, database service, authentication layer, telemetry, or direct OpenStreetMap upload.

## Boundaries

- `src/domain/` contains framework-independent types and pure rules. It owns feed identity, stop eligibility, profile validation, spatial evidence, review state, session compatibility, and export contracts.
- `src/infrastructure/gtfs/` streams local ZIP bytes into the `stops.txt` CSV parser. The importer never opens timetable files and never persists raw ZIP bytes.
- `src/infrastructure/osm/` constructs bounded Overpass POST requests, parses OSM nodes and tagged platform ways into point candidates, performs local matching, and serializes OSM Change XML. Platform ways retain their member references so tag changes can be exported without changing their geometry. The endpoint is passed only to the request function and is never part of a persisted type.
- `src/storage/` owns IndexedDB records. Records are keyed by immutable session IDs and contain no operational endpoint URLs.
- `src/workers/` contains long-running import and matching message contracts. Worker errors are typed and sanitized before they reach the UI.
- `src/components/` and `src/features/` contain React presentation and interaction. They consume domain contracts rather than importing domain code from browser-specific modules.

## Session lifecycle

An import is staged under a new session ID. Only after every selected archive has a valid source identity, required `stops.txt` columns, unique stop IDs, and validated derived records does the active-session pointer change. A failed or cancelled staging operation removes its records and leaves the previous active session untouched.

Feed fingerprints, the sorted source-set fingerprint, profile fingerprints, and OSM snapshot IDs are compatibility keys. A changed source set or profile cannot reuse an old snapshot, review decision, or draft. An OSM snapshot refresh invalidates review state and drafts.

## OSM privacy boundary

The mapper supplies an HTTPS Overpass-compatible endpoint in an obscured, session-only control. Requests use `cache: "no-store"` and bounded streaming response parsing. Error messages expose only a category and safe HTTP status; they never include the endpoint, request body, or response text. Synthetic fixtures are used in tests, and no repository test executes a live Overpass request.
