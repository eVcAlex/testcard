# Testcard

A dark, watermark-free IPTV player for Windows. Xtream Codes and M3U sources, an embedded
`mpv` for playback (HEVC/E-AC-3 included — see [ADR 0001](docs/adr/0001-mpv-playback-engine.md)),
SQLite-backed so it stays fast at tens of thousands of channels.

Built as a free alternative to the paywalled features (dark mode, no watermark, playlist
auto-refresh) in commercial IPTV players. See [`CONTEXT.md`](CONTEXT.md) for the domain
glossary and [`docs/adr/`](docs/adr) for the decisions behind non-obvious choices.

## Status

Live TV works end to end. `packages/core`'s source parsing, normalisation and database layer
are built and unit-tested; the desktop shell (`apps/desktop`) has a typed IPC bridge, embedded
mpv playback (see `scripts/fetch-mpv.md` for the one manual setup step), and a channel
browser with search, favourites, recents, and an EPG timeline guide. Sources (Xtream or M3U)
can be added, edited, removed, and refreshed by hand or on a per-source schedule (Off / 6h /
12h / 24h) via a background scheduler.

Not built yet: VOD and series (only live channels import today). See
[`docs/phase-3-brief.md`](docs/phase-3-brief.md) for the most recent phase close-out and
[`docs/adr/`](docs/adr) for the decisions behind non-obvious choices along the way.

## Development-time TypeSafe/Jev audit (optional)

Category genres come from deterministic rules in `packages/core` (see
[ADR 0007](docs/adr/0007-category-classification-and-dev-time-ai.md)); the app never calls an AI
service. To audit those rules against TypeSafe/Jev while developing, put `TYPESAFE_API_KEY` in your
*own* environment (never in this repo) and run
`pnpm --filter @testcard/core eval:categories` with `CATEGORY_NAMES_FILE` pointing at a JSON of
provider category names.

## Requirements

- Node.js 22+, pnpm 10+
- Windows (this targets Win32 — see ADR 0001's `--wid` approach)

## Getting started

```sh
pnpm install
pnpm --filter @testcard/core test     # unit tests for the parsing/normalisation layer
pnpm dev                               # launches the Electron app
```

To exercise real playback, follow `scripts/fetch-mpv.md` first (a one-time manual download —
not automated on purpose).

## Repo layout

```
packages/core/     pure TypeScript: source adapters (Xtream, M3U), name normalisation,
                    XMLTV/EPG parsing, SQLite schema + import. Zero Electron, zero React —
                    the only part of this codebase a future Android/Firestick app reuses.
apps/desktop/       the Electron app: main process (SQLite, credentials, mpv bridge, IPC),
                    preload (typed bridge), renderer (React UI).
docs/adr/           decisions worth recording — see CONTEXT.md's own note on when we write one.
```

## Known gotcha: better-sqlite3's native binary targets one runtime at a time

`better-sqlite3` compiles a native `.node` binary that must match the exact Node ABI of
whatever loads it. `apps/desktop`'s `postinstall` runs `electron-rebuild` so the binary
matches **Electron's** bundled Node — required for `pnpm dev`/`pnpm package` to work at all.

This means the binary is *not* built for your system Node. It happens not to matter today
because nothing in `pnpm --filter @testcard/core test` touches SQLite. It will matter the
day a test opens a real database outside Electron (e.g. testing `importSource`/`openDatabase`
directly under Vitest) — that test run would need `pnpm rebuild better-sqlite3` back to the
system Node ABI first, and `pnpm install` (which reruns the Electron rebuild) after. If this
becomes a recurring annoyance, look at running those specific DB tests through Electron's own
test runner instead of plain Vitest.

## Security

Provider credentials are extracted from a pasted playlist URL, probed once, then stored via
Electron's `safeStorage` (Windows DPAPI) — see `apps/desktop/src/main/credentials.ts`. They are
never written to the SQLite database, never logged, and the renderer process never has access
to them or to raw stream URLs; it only ever holds internal channel/source ids. No playlist or
credential data is ever committed to this repo (see `.gitignore`).

## Publishing a release

Not set up yet. `apps/desktop/electron-builder.yml` is configured for an NSIS installer
published to GitHub Releases with `electron-updater` — once this repo has a GitHub remote, add
a `repository` field to the root `package.json` and `pnpm --filter @testcard/desktop package`.
The installer is unsigned, so Windows SmartScreen will warn on first run.
