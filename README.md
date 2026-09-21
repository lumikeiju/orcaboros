# Orcaboros

Orcaboros is a private, browser-first tool for reviewing conflation between local Puget Sound GTFS stop feeds and OpenStreetMap nodes and tagged platform ways. It imports only selected local `stops.txt` files, keeps operational endpoints in memory, and downloads a deterministic OSM Change file for manual review in JOSM.

## Status

Release 1 is an active pre-release (`0.1.0`). The application is intentionally backendless and does not upload edits to OpenStreetMap.

## Prerequisites

- [Bun](https://bun.sh/) 1.3.14 or newer
- A modern browser with IndexedDB, Web Workers, Web Crypto, and fetch support

## Setup

```sh
bun install
bun run dev
```

Open the local Vite URL in a browser. Feed archives can be selected together from the local file picker or dragged onto the archive drop area; unsupported ZIPs remain visible with a warning and are skipped during import. No remote GTFS source is supported. Stock mapping profiles are defined per feed in [`src/profiles/`](src/profiles/).

After OSM retrieval, the Review Queue shows review results in pages. New GTFS stops, removed OSM identities, and moved stops are shown by default; exact stop ID matches are available through the filter controls. Selecting a feature marker on the map focuses the matching item in the Review Queue, and selecting a queue item focuses it on the map.

The candidate map starts on the shared world globe view (longitude 0, latitude 0, zoom 0) using the documented [MapLibre adaptive globe projection](https://maplibre.org/maplibre-style-spec/types/#use-a-projection-preset) and transitions toward Mercator as you zoom in. It uses a colorblind-friendly palette with redundant marker shapes: blue circles for stops with a candidate match, cyan triangles for identity matches outside the auto-match radius, olive squares for stops with no candidate, purple diamonds for removed identities, and teal crosses for nearby candidate context. At regional zooms these statuses become low-blend density heat layers; zoom in to roughly the intersection scale for individual symbols. A gold ring marks a stop that has been processed in the review queue.

## Configuration and privacy

Known feed IDs select their stock mapping profile automatically from the profile dictionary. After import, the profile editor lists every `stops.txt` field and lets the mapper assign an OSM tag key; conditional and constant rules remain available for profile-specific behavior. Overpass-compatible endpoints are entered per browser session in an obscured field and are never persisted in IndexedDB, profiles, routes, logs, or exports. Browser requests use only CORS-safelisted headers and an explicit strict-origin referrer policy, so the browser supplies its normal `User-Agent` and referring origin without a preflight. Browser JavaScript cannot set the required application-specific `User-Agent`; providers that enforce that requirement need a server-side request path and are not compatible with this browser-only release. The application does not make an Overpass request until the mapper explicitly starts retrieval. This repository contains no production GTFS archive or OSM response.

The export downloads a JOSM-compatible `.osm` file. Its `<changeset>` section includes the Orcaboros website and the generated GTFS public-transport edit comment; JOSM does not read that metadata from the proposed `<changeset>` section in standard `.osc` files.

See [`docs/architecture.md`](docs/architecture.md) for the data boundaries and [`docs/mapping-profiles.md`](docs/mapping-profiles.md) for the profile format. The accepted architecture decision is recorded in [`docs/adr/0001-browser-first-worker-based-node-conflation.md`](docs/adr/0001-browser-first-worker-based-node-conflation.md).

## Development

```sh
bun run dev          # Start Vite development server
bun run test         # Run unit and component tests
bun run typecheck    # Run strict TypeScript checks
bun run build        # Build static output
bun run check        # Format, typecheck, test, and build
```

Use small synthetic fixtures under `tests/fixtures/` when testing. Do not add local feed archives, private endpoint URLs, or downloaded OSM responses.

## Validation and accessibility

Run `bun run check` before opening a pull request. User-facing controls follow WCAG 2.2 AA semantics: visible labels, keyboard-operable actions, focus styles, non-color state cues, and a textual alternative to the map review surface.

## Release and deployment

The output of `bun run build` is a static site in `dist/` and can be hosted on any conventional static host. Hosting provider, CI deployment, authentication, telemetry, OSM OAuth, direct OSM uploads, and JOSM Remote Control are intentionally deferred.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report issues at <https://github.com/lumikeiju/orcaboros/issues>.

## License

Licensed under the [MIT License](LICENSE).
