# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Release process:** the section for the version being released is read from
> this file and used as the GitHub Release body. Keep `## [Unreleased]`
> up-to-date as you develop, then "cut" it into a versioned section at release
> time. See `AGENTS.md` → "Release & Changelog" for the full workflow.

## [Unreleased]

### Added
- V2EX plugin with public API support
- `CHANGELOG.md` and release changelog mechanism; release notes now sourced from this file
- `README.md`; `CLAUDE.md` reorganized into `AGENTS.md` with a pointer `CLAUDE.md`

### Changed
- Open all links in the system browser uniformly

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

[Unreleased]: https://github.com/joyme123/feedflow/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/joyme123/feedflow/releases/tag/v0.1.0
