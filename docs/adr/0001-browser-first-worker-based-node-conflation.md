# ADR-0001: Browser-first, worker-based, safety-first node conflation

- **Status:** Accepted for release 1
- **Date:** 2026-09-10

## Decision

Orcaboros is a static React/Vite single-page application using strict TypeScript and Bun 1.3.14+. It accepts local individual Puget Sound GTFS ZIP files, parses only `stops.txt` in a worker, retrieves candidate OSM nodes from a mapper-supplied HTTPS Overpass-compatible endpoint, and downloads a reviewed OSM Change file for manual opening in JOSM.

All derived data is scoped to an immutable IndexedDB session. A source archive is fingerprinted while its raw bytes stream through the ZIP reader. The active session pointer changes only after source identity, required-column, duplicate ID, eligibility, and derived-data validation succeeds. Profile, feed, and OSM snapshot fingerprints invalidate incompatible review records.

The only automatic match is a unique exact namespaced identity tag within the configured 10 m radius. Name and distance evidence can rank review candidates within 50 m but can never auto-select. Existing OSM tags are preserved unless the mapper explicitly accepts a replacement or removal. New nodes are manual creates and release 1 never emits deletes or uploads edits.

## Consequences

The application can be hosted as static files and private endpoint credentials remain in browser memory. The stop-only importer is intentionally unable to derive schedules, route membership, opening hours, or agency ownership. Manual review is slower than unattended conflation but makes each tag change auditable and produces a deterministic `.osc` file.

## Deferred work

Remote GTFS acquisition, the consolidated `US-WA-PSC` feed, timetable parsing, ways and relations, arbitrary mapping expressions, OSM OAuth/API uploads, JOSM Remote Control, and hosting-provider integration are outside release 1.
