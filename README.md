# Orcaboros

Orcaboros is a browser-only tool for reviewing GTFS stops against OpenStreetMap nodes and tagged platform ways. It reads `stops.txt` from selected GTFS ZIPs and prepares a JOSM-compatible change file for manual review.

## Status and safe use

Pre-release. Orcaboros does not upload changes to OpenStreetMap. Review every proposal, confirm the feed license permits derived data to be contributed under the ODbL, and follow the [OSM Automated Edits Code of Conduct](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct) when applicable.

## Use

1. Select GTFS ZIPs and review the mapping profile.
2. Enter an Overpass-compatible endpoint and explicitly start OSM retrieval.
3. Review proposed matches and changes, then export the file for review in JOSM.

Only `stops.txt` is read; remote GTFS feeds are not supported. Endpoint settings are session-only and never persisted or logged. OSM requests begin only when you start retrieval.

## Development

Requires [Bun](https://bun.sh/) 1.3.14 or newer and a modern browser.

```sh
bun install
bun run dev
bun run check
```

`bun run check` formats, type-checks, tests, and builds the app.

See [architecture](docs/architecture.md), [mapping profiles](docs/mapping-profiles.md), and [contribution guidance](CONTRIBUTING.md) for details.

## Release and deployment

`main` contains source; `beta` and `stable` contain generated site output only. Run [Promote site](.github/workflows/promote.yml) manually from `main`:

- **Beta** runs checks, publishes a prerelease artifact, and updates the `beta` output branch.
- **Stable** requires a tested beta tag and confirmation. It verifies the candidate matches `beta`, promotes the same build without rebuilding, and verifies `stable` matches.

The stable site is <https://lumikeiju.dev/orcaboros/>.

## License

[MIT](LICENSE)
