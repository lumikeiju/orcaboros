# Orcaboros

Orcaboros is a private, browser-first tool for reviewing conflation between local Puget Sound GTFS stop feeds and OpenStreetMap nodes. It imports only selected local `stops.txt` files, keeps operational endpoints in memory, and downloads a deterministic OSM Change file for manual review in JOSM.

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

Open the local Vite URL in a browser. Feed archives are selected from the local file picker; no remote GTFS source is supported. The default mapping profile is [`src/profiles/puget-sound.json`](src/profiles/puget-sound.json).

## Configuration and privacy

The profile editor accepts direct source-field or constant tag mappings only. Overpass-compatible endpoints are entered per browser session in an obscured field and are never persisted in IndexedDB, profiles, routes, logs, or exports. The application does not make an Overpass request until the mapper explicitly starts retrieval. This repository contains no production GTFS archive or OSM response.

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
