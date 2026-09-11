<!-- @format -->

# Contributing to Orcaboros

Read [AGENTS.md](AGENTS.md) first.

## Prerequisites and setup

Install Bun 1.3.14 or newer, run `bun install`, and use `bun run dev` for local development. The application is a static React/Vite site and requires no environment variables or service credentials.

## Reporting issues

Report bugs, feature requests, and security concerns at <https://github.com/lumikeiju/orcaboros/issues>. Do not include credentials, private Overpass URLs, local feed archives, or downloaded OSM responses in public reports.

## Pull requests

1. Create a focused branch in the format `type/scope/short-description`.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) if a commit is requested.
3. Run `bun run check`.
4. Update documentation when behavior, configuration, or contributor workflows change.
5. Verify applicable WCAG 2.2 AA requirements for user-facing changes.
6. Describe the change, validation performed, and user impact.

Do not commit local storage, production feed archives, secrets, or endpoint URLs. Release 1 does not accept direct OSM uploads.
