<!-- @format -->

# Orcaboros conventions

Read this file before editing.

- Use [Conventional Commits](https://www.conventionalcommits.org/) (`type(scope): description`) when a commit is explicitly requested.
- Name branches in the format `type/scope/short-description`.
- Keep changes focused, update related documentation, and validate them with `bun run check`.
- This versioned private application follows Semantic Versioning.
- Ensure user-facing interfaces meet or exceed WCAG 2.2 Level AA.
- Use Bun 1.3.14 or newer and keep the package manager metadata synchronized.
- Place application source in `src/` and tests in `tests/`.
- Keep domain logic framework-independent and strictly typed. Do not use `any`, broad catches, or silent error fallbacks.
- Never persist or log operational Overpass or custom basemap URLs.
- Release 1 is browser-only: do not add a server, remote GTFS fetch, direct OSM upload, JOSM Remote Control, schedule parsing, or unsupported OSM feature types.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow.
