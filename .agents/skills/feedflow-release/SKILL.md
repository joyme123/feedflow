---
name: feedflow-release
description: |
  Cut a new FeedFlow release: version the CHANGELOG, bump package.json, tag,
  and push so the GitHub Release workflow builds all platforms and publishes.
  Use this skill whenever the user wants to "发布新版本", "release", "cut a
  release", "发版", "打 tag 发布", "publish a new version", or mentions
  shipping a new version of the desktop app. Also covers the Chrome extension
  publish rules (only published when extensions/ code changed).
---

# FeedFlow Release Workflow

FeedFlow releases are driven by **git tags** + **CHANGELOG.md**. Pushing a
`vX.Y.Z` tag triggers the [Release workflow](.github/workflows/release.yml),
which verifies the version, builds mac/win/linux packages, extracts the
matching `## [X.Y.Z]` section from `CHANGELOG.md` as the release notes, and
creates the GitHub Release.

## When to use this skill

- The user asks to release / publish / ship a new version (发布, 发版, cut a
  release, 打 tag, 新版本)
- Bumping the version and tagging after a set of changes lands
- Checking whether a release would succeed before pushing the tag

## The two rules that make a release valid

1. **`package.json` version must match the tag** (e.g. tag `v0.2.0` ↔
   `"version": "0.2.0"`). The workflow fails on mismatch.
2. **`CHANGELOG.md` must have a `## [X.Y.Z] - YYYY-MM-DD` section** for the
   version being released. The extraction script
   (`scripts/extract-changelog-section.sh`) exits non-zero if it's missing,
   which fails the release.

## Step 1: Keep `[Unreleased]` up to date (do this as you develop)

`CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com/) +
[SemVer](https://semver.org/). As changes land, add entries to the
`## [Unreleased]` section under the right category:

- `### Added` — new features
- `### Changed` — changes to existing functionality
- `### Deprecated` — soon-to-be-removed features
- `### Removed` — removed features
- `### Fixed` — bug fixes
- `### Security` — vulnerability fixes

> This is part of the definition of done for a change — don't rely on memory
> at release time. If `[Unreleased]` is empty when it's time to release,
> either the changes don't warrant a release or entries were forgotten.

## Step 2: Choose the version number

Follow SemVer against the **current** version in `package.json`:

| Change type | Bump | Example |
|-------------|------|---------|
| Bug fixes only | patch | `0.2.0` → `0.2.1` |
| New features | minor | `0.2.1` → `0.3.0` |
| Breaking changes | major | `0.3.0` → `1.0.0` |

While in `0.x`, breaking changes may bump minor instead of major — use
judgment. The Chrome extension has its **own** version in
`extensions/cookie-sync/manifest.json` and is **not** tied to the desktop
version.

## Step 3: Cut the release (4 edits + commit + tag)

1. **Rename the section** in `CHANGELOG.md`:
   ```
   ## [Unreleased]              →   ## [0.2.0] - 2026-08-09
   ```
   Use the actual release date (ISO 8601, `YYYY-MM-DD`).

2. **Add a fresh empty `## [Unreleased]`** above the versioned section so
   development can continue accumulating entries.

3. **Update the comparison links** at the bottom of `CHANGELOG.md`:
   ```
   [Unreleased]: https://github.com/joyme123/feedflow/compare/v0.2.0...HEAD
   [0.2.0]: https://github.com/joyme123/feedflow/compare/v0.1.0...v0.2.0
   ```
   The previous `[Unreleased]` link becomes the new version's link; add a new
   `[Unreleased]` link pointing from the new tag to `HEAD`.

4. **Bump `package.json`** `"version"` to `0.2.0` (must match the tag).

5. **Commit** both files:
   ```bash
   git add CHANGELOG.md package.json
   git commit -m "chore: release v0.2.0"
   ```

6. **Tag and push** (this triggers the release):
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   git push origin main
   ```

## Step 4: What the Release workflow does

Triggered by `push` of a tag matching `v[0-9]+.[0-9]+.[0-9]+` (or
`vX.Y.Z-*` for pre-releases). Jobs run in order:

| Job | What it does |
|-----|--------------|
| `version-check` | Asserts tag == `package.json` version; fails otherwise |
| `package-extension` | Builds the Chrome extension ZIP (always runs) |
| `build` | Builds mac (arm64 + x64), win (x64), linux (x64) packages |
| `release` | Downloads all artifacts, extracts `## [X.Y.Z]` from `CHANGELOG.md`, creates the GitHub Release with that body, uploads installers |
| `publish-extension` | Uploads extension to Chrome Web Store — **only if** `extensions/` changed since the last release tag AND credentials are configured |

### Chrome extension publish rule (important)

The extension is **not** re-published on every desktop release. The
`publish-extension` job runs `git diff <prev-tag> HEAD -- extensions/`:

- **No change** → skips publishing (logs a notice). No wasted review queue.
- **Changed** → uploads and submits for review.
- **First release / no previous tag** → publishes (treated as first time).

The extension has its own version in `manifest.json`; bump it when you change
extension code so the store accepts the upload.

## Step 5: Verify

- Watch the [Actions page](https://github.com/joyme123/feedflow/actions) for
  the `Release` run. `version-check` failing means tag ≠ `package.json`.
- `release` job failing usually means the `## [X.Y.Z]` section is missing
  from `CHANGELOG.md`.
- On success, the [Releases page](https://github.com/joyme123/feedflow/releases)
  shows `vX.Y.Z` with installers and the changelog body.

## Common mistakes

- **Pushing the tag without bumping `package.json`** → `version-check` fails.
- **Forgetting to add the `## [X.Y.Z]` section** → `release` job fails
  (extraction script exits non-zero).
- **Wrong date format** → must be `YYYY-MM-DD` (e.g. `2026-08-09`).
- **Editing `[Unreleased]` but not the comparison links** → links go stale.
- **Bumping extension version but not changing `extensions/`** → still won't
  publish (the diff check looks at code, not just manifest version).
- **Tag format** → must be `vX.Y.Z` (leading `v`), e.g. `v0.2.0`, not `0.2.0`.

## Files involved

- `CHANGELOG.md` — source of truth for release notes
- `package.json` — desktop app version (must match tag)
- `extensions/cookie-sync/manifest.json` — extension version (independent)
- `.github/workflows/release.yml` — the release pipeline
- `scripts/extract-changelog-section.sh` — pulls the version section for the
  release body
- `scripts/package-extension.mjs` — builds the extension ZIP
- `scripts/publish-chrome-web-store.mjs` — uploads extension to the store
