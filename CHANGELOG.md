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
- 设置中支持配置 HTTP/HTTPS/SOCKS5 代理（「设置 → 网络」），保存后立即生效；各信息源可在配置中单独开关「通过代理服务器访问」（X 关注流默认开启），插件 API 请求与时间线图片/视频媒体均可走代理，本地服务（MCP、Cookie 同步）自动绕过。解决无翻墙环境下 X Cookie 同步验证超时、信息流无法刷新、图片视频加载失败的问题
- 网络设置自动预填系统代理：支持 macOS / Windows / Linux 系统代理设置与 PAC 自动配置脚本，并兼容 HTTPS_PROXY 等环境变量；另提供「检测系统代理」按钮手动填充
- 全新应用图标（macOS / Windows / Linux）及 Chrome 扩展图标

### Changed
- Electron 31 升级至 44：旧版 Electron 31.7.7 的 Apple 公证票据被撤销，在 macOS 26 上会被 XProtect 判定为恶意软件并移入废纸篓导致无法启动；同步将 better-sqlite3 升级至 13（N-API，适配新版 V8）

### Fixed
- 修复 X 信息流图片被错误地以视频播放器展示的问题：X 图片 URL 带有 `:large` 尺寸后缀（如 `pbs.twimg.com/media/xxx.jpg:large`），渲染端按扩展名结尾判断图片类型时未识别，被当成非图片 URL 塞进 `<video>` 标签；判断前先去掉 Twitter 尺寸后缀，已存入数据库的旧条目无需重新拉取即可恢复
- 开发模式下点击「检查更新」报 `No handler registered for 'updates:check'`：dev 下也注册更新相关 IPC，点击时明确提示"开发模式不检查更新"，不再抛错；生产环境行为不变

## [0.3.0] - 2026-09-16

### Added
- 支持用户上传 zip 压缩包安装插件：解压后自动校验 `package.json` 的 `feedflow` 字段与 `fetchItems` 实现，安装到 `{userData}/plugins/` 并即时注册生效
- 插件列表区分「内置」与「用户安装」来源，用户安装的插件支持一键删除（同时清理目录、DB 记录及关联的信息源/条目）
- 新增 GitHub Trending 插件：抓取 github.com/trending 热门仓库，支持按语言和时间范围过滤，无需认证
- 新增 Hacker News 插件：基于官方公开 API，支持 Top / New / Best / Ask HN / Show HN / Jobs 多种信息流，无需认证
- 新增 Product Hunt 插件：双模式——无 Token 时使用公开 Atom Feed（产品名 + 标语），填写 Developer Token 后使用 GraphQL API 获取完整描述、投票数、评论数、缩略图等

### Changed
- Chrome 扩展 Cookie 同步升级：新增定期强制重同步（每 10 分钟）与失败自愈闭环——桌面端检测到 Cookie 失效时标记 provider，扩展在 1 分钟心跳内自动重同步浏览器最新 Cookie，必要时后台打开隐藏标签页触发站点轮换 cookie，验证通过后自动重新拉取对应信息流，全程无需手动操作
- Chrome 扩展版本 1.1.0 → 1.2.0
- 凭据与 Cookie 授权按真实情况区分：仅微博、X 等真正使用浏览器 Cookie 的 provider 出现在 Chrome 扩展弹窗中；GitHub Trending、Hacker News（无需认证）和 Product Hunt、V2EX（使用 Token）不再显示「授权」按钮。桌面端凭据面板也只展示需要凭据的 provider，并正确区分 Cookie / Token 类型

### Fixed
- 刷新失败提示按当前浏览的信息源过滤：单源视图只显示该源的错误，不再在 v2ex 等源下弹出微博等其它源的 Cookie 检查报错
- 修复已安装 Chrome 扩展但凭据页仍显示"安装扩展"提示的问题：Cookie 同步成功时即标记扩展活跃，并将 `extensionLastSeen` 持久化到 settings，App 重启后不再丢失状态

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

[Unreleased]: https://github.com/joyme123/feedflow/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/joyme123/feedflow/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/joyme123/feedflow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/joyme123/feedflow/releases/tag/v0.1.0
