# Orcaboros

Orcaboros is an in-browser GTFS-to-OSM conflation tool.

## Use

1. Upload GTFS ZIP file(s)
2. Configure field-mapping profile
3. Retrieve OSM data via Overpass
4. Review and update conflation matches
5. Export changeset for review and upload via JOSM

## Development

Requires [Bun](https://bun.sh/) and a modern browser.

```sh
bun install
bun run dev
```

See [architecture](docs/architecture.md), [mapping profiles](docs/mapping-profiles.md), and [contribution guidance](CONTRIBUTING.md) for details.

## Release and deployment

`main` contains source; `beta` and `stable` contain generated site output only. Run [Promote site](.github/workflows/promote.yml) manually from `main`:

- **Beta** runs checks, publishes a prerelease artifact, and updates the `beta` output branch.
- **Stable** requires a tested beta tag and confirmation. It verifies the candidate matches `beta`, promotes the same build without rebuilding, and verifies `stable` matches.

The stable site is <https://lumikeiju.dev/orcaboros/>.

## License

[MIT](LICENSE)
