# Orcaboros architecture

Orcaboros is a static React/Vite application; the browser is its only application runtime. It reads uploaded GTFS ZIPs, retrieves OSM candidates only when the user starts retrieval, and downloads a JOSM-compatible `.osm` file for manual review. There is no application server, proxy, backend database, authentication, telemetry, remote GTFS fetch, or direct OSM upload.

## Code boundaries

- `src/domain/` defines framework-independent feed, profile, stop, matching, review, session, and change contracts and rules.
- `src/infrastructure/gtfs/` streams only `stops.txt` from local ZIPs through the CSV importer. It fingerprints archives but never persists raw ZIP bytes.
- `src/infrastructure/osm/` builds bounded Overpass POST queries, parses OSM nodes and tagged platform ways, matches candidates locally, and validates and serializes JOSM XML.
- `src/workers/` runs GTFS import and matching off the UI thread; `src/features/` provides their UI clients. `src/App.tsx` and `src/components/` own workflow and presentation.
- GTFS map popups let users reassign a stop to an OSM element with a preview that snaps to nearby candidates; the current connection remains until a target is selected, and the new selection is stored with the review. All established stop-to-OSM connections appear at every zoom level.
- `src/storage/` persists profiles, imported stops, OSM snapshots, reviews, and export drafts in IndexedDB under immutable session IDs.

## Session lifecycle

Imports are staged under a new ID and activated only after all selected archives process successfully. Failure or cancellation discards staging and preserves the previous active session. The source-set and profile fingerprints, plus the OSM snapshot ID, define compatibility. Changing the source set or profile invalidates the snapshot, reviews, and draft; refreshing the snapshot invalidates reviews and the draft.

Selecting replacement archives does not alter the active session. Review and profile writes are serialized; IndexedDB verifies the active session and writes it in one transaction. Snapshot refreshes commit only after retrieval and matching succeed, and cancellation also stops the matching worker. Restoring a session rebuilds its candidate evidence before exposing the saved reviews.

Exports use the saved session/snapshot identities and honor the reviewed tag resolutions without silently reapplying name cleanup or removals. Conflicting geometry or tag decisions for a shared OSM element block export. The draft must save successfully before a download starts. OSM-only identities can be marked reviewed unchanged; this records progress without adding deletions to the export.

## Network and privacy

The user supplies an HTTPS Overpass-compatible endpoint and starts retrieval explicitly. Requests are POSTed without caching, bounded by the stop extent and response limits, and errors are sanitized. Tests use synthetic fixtures, never live Overpass requests. Overpass endpoints and custom MapLibre style URLs are session-only and are never persisted or logged.

Overpass runtime-error remarks and malformed or unsupported elements fail the request rather than becoming an apparently empty or partial snapshot. ZIP decompression and CSV validation failures propagate through the importer, including asynchronous decompression, and duplicate `stops.txt` entries are rejected.
