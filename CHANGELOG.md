# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Release process:** the section for the version being released is read from
> this file and used as the GitHub Release body. Keep `## [Unreleased]`
> up-to-date as you develop, then "cut" it into a versioned section at release
> time. See `AGENTS.md` → "Release & Changelog" for the full workflow.

## [Unreleased]

## [0.2.0] - 2026-08-09

### Added
- V2EX plugin with public API support
- Chrome 扩展 Cookie 自动同步
- Chrome 扩展自动发布流程 + 隐私权政策
- `CHANGELOG.md` and release changelog mechanism; release notes now sourced from this file
- `README.md`; `CLAUDE.md` reorganized into `AGENTS.md` with a pointer `CLAUDE.md`
- X (Twitter) plugin: inline expansion of truncated long tweets via `fetchItemDetail` (mirrors weibo "展开更多" behavior)

### Changed
- Open all links in the system browser uniformly
- Timeline "展开" button now shown whenever content is actually clipped by CSS line-clamp (was previously gated on a 300-character threshold, so many multi-line posts had no expand control)

### Fixed
- X (Twitter) plugin: fix `fetchItemDetail` returning HTTP 422 by updating the stale `TweetResultByRestId` and `Viewer` GraphQL operation IDs, fixing the dynamic operation-ID resolver to look at `x.com/home` (where `main.{hash}.js` is still served), and adding the `longform_notetweets_*` feature flags required to fetch full `note_tweet` text
- 微博 plugin: fix XSRF-TOKEN 失效导致关注时间线拉取失败

## [0.1.0] - 2026-08-01

First stable release.

### Added
- Multi-source feed aggregation (微博 home timeline, 微博 group chat, X home timeline)
- Plugin system: sources are plugins under `plugins/` with a `FeedFlowPlugin` interface
- Encrypted credential management (cookies scoped by `provider`, shared across plugins)
- Provider concept: credentials belong to a provider (e.g. `weibo`, `x`) rather than a single plugin
- Independent Settings page (credentials, plugins, MCP)
- MCP Server exposing `list_sources`, `list_items`, `search_items`, `get_item`, `refresh_source` over HTTP
- Inline expansion of truncated items (e.g. long weibo posts) via `fetchItemDetail`
- Pull-to-refresh and infinite scroll in the timeline
- In-app auto-update via `electron-updater`
- GitHub Actions CI (build/type-check) and Release (mac/win/linux packaging + signing/notarization) workflows

### Fixed
- X video playback, startup auto-refresh, and invalid tweet filtering
- 微博 group chat image loading
- Various `provider` migration and default-value issues

[Unreleased]: https://github.com/joyme123/feedflow/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/joyme123/feedflow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/joyme123/feedflow/releases/tag/v0.1.0
