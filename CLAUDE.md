# Harbor: project rules

Harbor is a Windows dock and menu bar: **Tauri 2** with a Rust backend (`src-tauri/`)
and a **React + TypeScript + Vite** frontend (`src/`). The backend talks to Win32
directly (appbar, window list, Core Audio, shell icons). The frontend is one bundle
that renders a different surface per window label (`bar`, `dock`, `widgets`, `settings`).
The dock/bar config is owned by the backend: `save_config` sanitizes and broadcasts
`config-changed`, and every window follows it through `useConfig()` in `src/lib/config.ts`.
Never keep a private copy of the config in a window and save it back wholesale.

## 1. Every change is verified on both backend and frontend

Every change must be checked on **both** sides before it counts as done, even if
it seems to touch only one. The two sides are coupled through `invoke`
command names and payload shapes. A Rust rename or a serde field change breaks
the frontend at runtime, not at compile time.

Run all of these, in this order, and read the output:

```sh
npm run check:frontend   # tsc --noEmit + vite build
npm run check:backend    # cargo fmt --check + clippy -D warnings + cargo test
npm run check:release    # versions agree, CHANGELOG.md is well-formed
npm run check:attribution  # no AI attribution in files or commit messages
```

(`npm run check` runs all four.)

Then cross-check the contract by hand whenever a command is added, renamed or changed:

- the `#[tauri::command]` fn in `src-tauri/src/commands/*.rs`,
- its entry in `generate_handler![...]` in `src-tauri/src/lib.rs`,
- the wrapper and types in `src/lib/api.ts` (argument names are camelCase on the JS side;
  structs use `#[serde(rename_all = "camelCase")]`),
- every component that calls it.

New windows also need an entry in `tauri.conf.json` **and** in
`src-tauri/capabilities/default.json`. New plugin APIs used from JS need their
permission in that capability file.

For behaviour changes, run the app (`npm run tauri dev`) and exercise the change.
If you could not run something, say so explicitly. Never report a check you didn't run as passing.

Code rules that the checks enforce: no clippy warnings, `cargo fmt` formatting,
TypeScript `strict` with no unused locals or parameters.

## 2. Changelog: Keep a Changelog 1.1.0

`CHANGELOG.md` follows <https://keepachangelog.com/en/1.1.0/> and the project uses
[Semantic Versioning](https://semver.org/).

- Every user-visible change adds a line under `## [Unreleased]` **in the same change**.
- Group entries under these headings only, in this order: `Added`, `Changed`, `Deprecated`,
  `Removed`, `Fixed`, `Security`. Omit empty groups.
- Write for users, not for the diff: say what changed for them ("Weather card shows a
  5-day forecast"), not commit messages or file names.
- Newest release first. Dates are ISO `YYYY-MM-DD`. Every version heading has a link
  reference at the bottom of the file, and `[unreleased]` compares the last tag to `HEAD`.
- Do not edit already-released sections except to mark one `[YANKED]`.
- Pure refactors, CI or test-only changes need no entry (label the PR `skip-changelog`).

**Cutting a release `X.Y.Z`:**

1. Rename `## [Unreleased]` entries into a new `## [X.Y.Z] - YYYY-MM-DD` section and leave
   an empty `## [Unreleased]` above it.
2. Update the link references at the bottom.
3. Bump the version in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`
   (they must match; `check:release` enforces it), then refresh `Cargo.lock` with `cargo check`.
4. Run the full check, commit, then tag `vX.Y.Z` and push the tag. The Release workflow
   verifies everything again, builds MSI/NSIS installers and drafts a GitHub release whose
   body is that changelog section.
5. **Publish the draft.** Installed copies update from
   `releases/latest/download/latest.json`, which only resolves to a *published*,
   non-prerelease release that anonymous users can read.

**In-app updates** use the Tauri updater:
- Bundles are signed with the key in `%USERPROFILE%\.tauri\harbor-updater.key`. Its password is
  stored next to it. The matching public key is in `tauri.conf.json` → `plugins.updater.pubkey`.
- The release job reads the private key from the `TAURI_SIGNING_PRIVATE_KEY` and
  `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` repository secrets, and fails early if they're missing.
- **Never commit the private key, and never lose it.** Installed copies only accept updates
  signed with it. A new key means everyone has to reinstall once.
- CI's installer smoke build disables updater artifacts, so it needs no secrets.

## 3. Commits and pull requests

- **No AI attribution anywhere**: no `Co-Authored-By` trailers for an AI, no
  "Generated with ..." lines, in commits, PR descriptions, code comments or docs.
  This is enforced in three places by `scripts/attribution-check.mjs`:
  - the `commit-msg` hook in `.githooks/` (installed by `npm install`) rejects the commit;
  - `npm run check:attribution` (part of `npm run check`) scans tracked files and history;
  - the CI `No AI attribution` job scans files, the PR's commits, and the PR title and description.

  The release workflow re-checks everything before building. This file and the script are the only
  files exempt, because they must name the patterns.
- Imperative, concise commit subjects (`Add currency widget`, `Fix dock icon cache`).
- Fill in `.github/pull_request_template.md`.

## 4. CI/CD

- `.github/workflows/ci.yml` runs on every PR and push to `main`:
  - frontend checks (Ubuntu);
  - backend checks (Windows);
  - a no-AI-attribution scan;
  - a changelog-entry requirement on PRs (the `skip-changelog` label opts out);
  - on `main` pushes only, a full installer build uploaded as an artifact.
- `.github/workflows/release.yml` runs on `v*.*.*` tags and produces a **draft** release. Publish it
  manually after reviewing.
- Dependabot opens weekly update PRs for npm, Cargo and Actions.

## 5. Local build environment (this machine)

This machine's Visual Studio Build Tools 2019 install is partial. It lacks `msvcrt.lib`,
`OLDNAMES.lib` and `legacy_stdio_definitions.lib`. Until the "MSVC v142 x64/x86 build
tools" and "Windows SDK" components are repaired in the VS Installer, `cargo` needs:

- `RUSTFLAGS=-C target-feature=+crt-static`;
- `LIB` and `INCLUDE` pointing at
  `...\2019\BuildTools\VC\Tools\MSVC\14.29.30133` and Windows SDK `10.0.19041.0`;
- a directory of empty stand-in `.lib` files for the two missing libraries.

CI runners have a complete toolchain and need none of this.

## 6. Scope and provenance

Harbor is an original implementation inspired by the *architecture* of an existing
dock app. Do not copy its code, assets, names or branding. Widgets use keyless public
APIs (Open-Meteo, Yahoo Finance chart, Binance public data, Frankfurter). All HTTP
goes through `commands/widgets.rs`, which validates parameters and caches responses.
Don't add a generic "fetch any URL" command.
