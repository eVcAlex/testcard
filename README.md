# Testcard

A dark, watermark-free IPTV player for Windows. Xtream Codes and M3U sources, an embedded
`mpv` for playback (HEVC/E-AC-3 included — see [ADR 0001](docs/adr/0001-mpv-playback-engine.md)),
SQLite-backed so it stays fast at tens of thousands of channels.

Built as a free alternative to the paywalled features (dark mode, no watermark, playlist
auto-refresh) in commercial IPTV players. See [`CONTEXT.md`](CONTEXT.md) for the domain
glossary and [`docs/adr/`](docs/adr) for the decisions behind non-obvious choices.

## Status

Early scaffolding. `packages/core`'s source parsing, normalisation and database layer are
built and unit-tested. The desktop shell (`apps/desktop`) boots, has a typed IPC bridge, and
can add an Xtream source / refresh it into SQLite from the UI. Embedded mpv playback
(`apps/desktop/src/main/mpv/`) is written but **not yet wired to the UI** — see
`scripts/fetch-mpv.md` for the one manual step needed before it can be exercised, and the
plan's build order for what comes after.

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
