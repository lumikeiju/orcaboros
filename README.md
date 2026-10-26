<h1 align="center">
  <img src="src/assets/main-dark.avif" alt="Orcaboros: a white orca curled into a ring above the lowercase wordmark, set against a misty forested river valley at dusk" width="100%" />
</h1>

<p align="center">
  <strong>Keeping GTFS and OSM in harmony.</strong><br />
  Sync GTFS feed data with OpenStreetMap data, entirely in your browser.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <a href="https://www.conventionalcommits.org/"><img src="https://img.shields.io/badge/Conventional%20Commits-1.0.0-FE5196?logo=conventionalcommits&logoColor=white" alt="Conventional Commits 1.0.0" /></a>
  <a href="https://semver.org/spec/v2.0.0.html"><img src="https://img.shields.io/badge/SemVer-2.0.0-blue" alt="Semantic Versioning 2.0.0" /></a>
  <a href="https://www.w3.org/TR/WCAG22/"><img src="https://img.shields.io/badge/a11y-WCAG%202.2%20AA%20target-2ea44f" alt="Accessibility target: WCAG 2.2 Level AA" /></a>
  <a href=".github/dependabot.yml"><img src="https://img.shields.io/badge/Dependabot-enabled-025E8C?logo=dependabot&logoColor=white" alt="Dependabot enabled" /></a>
  <a href="https://github.com/lumikeiju/orcaboros/actions/workflows/ci.yml"><img src="https://github.com/lumikeiju/orcaboros/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI status" /></a>
</p>

<p align="center">
  <a href="https://www.openstreetmap.org/"><img src="https://img.shields.io/badge/OpenStreetMap-7EBC6F?logo=openstreetmap&logoColor=white" alt="OpenStreetMap" /></a>
  <a href="https://bun.sh/"><img src="https://img.shields.io/badge/Bun-000000?logo=bun&logoColor=white" alt="Bun" /></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-20232A?logo=react&logoColor=61DAFB" alt="React" /></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white" alt="Vite" /></a>
  <a href="https://maplibre.org/"><img src="https://img.shields.io/badge/MapLibre%20GL%20JS-396CB2?logo=maplibre&logoColor=white" alt="MapLibre GL JS" /></a>
</p>

<p align="center">
  <a href="https://lumikeiju.dev/orcaboros/"><strong>Open the app</strong></a>
  &nbsp;·&nbsp;
  <a href="#how-it-works">How it works</a>
  &nbsp;·&nbsp;
  <a href="#stock-mapping-profiles">Stock profiles</a>
  &nbsp;·&nbsp;
  <a href="#documentation">Docs</a>
  &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <img src="src/assets/screenshot-dark.avif" alt="The Orcaboros review workspace in dark mode. A five-step workflow sidebar sits on the left. The map shows a GTFS stop popup linked to an OpenStreetMap node. Below it are a paginated review queue, Accept match, Skip feature and Create separate node buttons, and a side-by-side GTFS and OSM tag comparison table." width="100%" />
</p>

<p align="center">
  <em>Reviewing a GTFS stop against its matched OpenStreetMap node. Dark theme shown; a light theme is also available.</em>
</p>

## What is Orcaboros?

Orcaboros is an in-browser [GTFS](https://gtfs.org/)-to-[OpenStreetMap](https://www.openstreetmap.org/) conflation tool. It reads the stops from a transit agency's GTFS feed, finds the matching features already mapped in OSM, and walks you through every difference so you can decide what belongs in the map. When you are done, it exports a change file for you to inspect and upload with [JOSM](https://josm.openstreetmap.de/).

- **Local-first.** GTFS ZIPs are read in your browser; only `stops.txt` is parsed, and raw ZIP bytes are never stored. There is no application server, backend database, authentication, or telemetry.
- **Profile-driven.** A data-only JSON mapping profile decides which OSM tags each stop proposes, how names are cleaned up, and how close a match must be. Stock profiles cover nine Washington State feeds, and you can import, edit, and export your own.
- **Human-reviewed.** Every proposed addition, change, and removal goes through a review queue with a map and a per-tag GTFS-versus-OSM comparison. Nothing reaches the export unless you decided it should.
- **Safe to resume.** Sessions are saved in your browser's IndexedDB, so you can close the tab and pick up where you left off.
- **Accessible.** Orcaboros targets WCAG 2.2 Level AA, with visible keyboard focus, reduced-motion support, and both dark and light themes.

> [!IMPORTANT]
>
> Orcaboros is beta software and its output may be incorrect. Review every proposed change individually against the GTFS source and current OpenStreetMap data. Using this tool does not exempt you from the OSM [Automated Edits Code of Conduct](https://wiki.openstreetmap.org/wiki/Automated_Edits_code_of_conduct), and you are responsible for confirming that each feed's license permits contributing data derived from it to OSM.

## How it works

1. **Upload.** Add one or more GTFS ZIP files. Each feed gets an ID, which defaults to the ZIP filename.
2. **Profile.** If every feed ID has a stock profile, those profiles are combined automatically; otherwise you start from a blank custom profile. Review the field mappings, name cleanup, geometry target, and match radii.
3. **Retrieve.** Provide an HTTPS [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API)-compatible endpoint and start retrieval. Orcaboros fetches nearby OSM candidates and matches them locally.
4. **Review.** Work through the queue: accept a match, skip a feature, create a separate node, or relink a stop to a different OSM element from the map. Compare tags side by side and choose which values to keep.
5. **Export.** Download a JOSM-compatible `.osm` file, then review and upload it in JOSM. Orcaboros never uploads to OpenStreetMap itself.

## Stock mapping profiles

Each stock profile lives in `src/profiles/<FEED_ID>.json`. Name feeds in the upload step to match these IDs and their profiles load automatically.

| Feed ID     | Agency                   |
| ----------- | ------------------------ |
| `US-WA-CT`  | Community Transit        |
| `US-WA-ET`  | Everett Transit          |
| `US-WA-IT`  | Intercity Transit        |
| `US-WA-KCM` | King County Metro        |
| `US-WA-KT`  | Kitsap Transit           |
| `US-WA-PT`  | Pierce Transit           |
| `US-WA-SCM` | Seattle Center Monorail  |
| `US-WA-ST`  | Sound Transit            |
| `US-WA-WSF` | Washington State Ferries |

Feeds without a stock profile work too: Orcaboros creates a blank custom profile for them. See [mapping profiles](docs/mapping-profiles.md) for the full schema and behavior.

## Privacy and scope

- Your Overpass endpoint and any custom basemap URL are session-only and are never persisted or logged. Requests are bounded by the stops' extent, sent without caching, and have sanitized errors.
- Orcaboros contacts your Overpass endpoint only when you start retrieval. The map separately loads its basemap from [OpenFreeMap](https://openfreemap.org/) by default, or from a custom style URL if you supply one.
- Release 1 is deliberately small. It does not include a server, remote GTFS fetching, direct OSM upload, JOSM Remote Control, schedule parsing, or unsupported OSM feature types.

## Getting started

Use the stable site at <https://lumikeiju.dev/orcaboros/>, or run it locally. You need [Bun](https://bun.sh/) 1.3.14 or newer and a modern browser.

```sh
bun install
bun run dev
```

Before opening a pull request, run the full validation suite:

```sh
bun run check
```

Orcaboros is built with [React](https://react.dev/), [Vite](https://vite.dev/), [TypeScript](https://www.typescriptlang.org/), and [MapLibre GL JS](https://maplibre.org/).

## Documentation

| Document | What it covers |
| --- | --- |
| [Architecture](docs/architecture.md) | Code boundaries, session lifecycle, and network and privacy rules |
| [Mapping profiles](docs/mapping-profiles.md) | Profile schema, tag rules, name cleanup, geometry, and match radii |
| [Visual style](docs/style.md) | Frosted-glass theme, components, and accessibility guidance |
| [Contributing](CONTRIBUTING.md) | Setup, branch and commit conventions, and the pull request checklist |
| [Changelog](CHANGELOG.md) | Notable changes for each release |

## Release and deployment

`main` contains source; `beta` and `stable` contain generated site output only. Run [Promote site](.github/workflows/promote.yml) manually from `main`:

- **Beta** runs checks, publishes a prerelease artifact, and updates the `beta` output branch.
- **Stable** requires a tested beta tag and confirmation. It verifies the candidate matches `beta`, promotes the same build without rebuilding, and verifies `stable` matches.

## Acknowledgements

Credit to [TJ Horner](https://github.com/tjhorner) for [gtfs-janitor](https://github.com/tjhorner/gtfs-janitor) and to [Matt Whilden](https://github.com/watmildon) for [josm-validator-rules](https://github.com/watmildon/josm-validator-rules), which this project used as inspiration.

The default basemap is provided by [OpenFreeMap](https://openfreemap.org/).

Map data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) and available under the Open Database License.

## License

[MIT](LICENSE)

---

<p align="center">
  <img src="src/assets/ai-label.png" alt="AI-assisted project" title="AI-assisted project" width="32" height="32" />
</p>
