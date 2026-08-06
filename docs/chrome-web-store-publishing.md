# Chrome Web Store 自动发布配置指南

## 概述

`extensions/cookie-sync` 是 FeedFlow 的配套 Chrome 扩展，用于将浏览器中已登录的
微博、X、V2EX 等信息源 Cookie 同步到桌面端。

本项目已在 `scripts/package-extension.mjs`、`scripts/publish-chrome-web-store.mjs`
和 `.github/workflows/release.yml` 中配置好扩展的打包与自动发布流程：

- 推送符合 semver 的 tag（如 `v0.2.0`）时，CI 会自动将扩展打包为 ZIP，
  作为产物附加到 GitHub Release。
- 若仓库配置了 Chrome Web Store 发布凭据，CI 会进一步将 ZIP 上传并提交商店审核。

未配置凭据时，CI 会自动降级为「仅打包、不发布」，不会阻断 Release 流程。

---

## 本地打包

```bash
npm run package:extension
# 产物：feedflow-cookie-sync-v<manifest版本>.zip
```

脚本会从 `extensions/cookie-sync/` 内部打包，确保 `manifest.json` 位于 ZIP 根目录
（Chrome Web Store 强制要求），并排除 `README.md`、`generate-icons.js` 等开发期文件。

---

## 前置条件

- 已注册 **Chrome Web Store 开发者账号**（一次性 $5 注册费）：
  https://chrome.google.com/webstore/devconsole
- 已在开发者后台 **手动上传一次扩展**，获得固定的 **扩展 ID**（Item ID）。
  自动发布只能更新已存在的商品，不能创建新商品。

---

## 一、创建 Google 服务账号（Service Account）

Chrome Web Store API 使用 **服务账号 + JWT** 的方式鉴权，无需用户交互。

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，创建或选择一个项目。
2. 进入 `IAM 和管理` → `服务账号` → `创建服务账号`，名称随意（如 `feedflow-cws-publisher`）。
3. 在服务账号详情页 → `密钥` → `添加密钥` → `创建新密钥` → 类型选 **JSON**，
   下载私钥文件（只能下载一次，妥善保存）。
4. 记录服务账号的 **邮箱地址**（`client_email` 字段，形如
   `feedflow-cws-publisher@<project>.iam.gserviceaccount.com`）。

---

## 二、授权服务账号访问 Chrome Web Store

1. 打开 [Chrome Web Store 开发者后台](https://chrome.google.com/webstore/devconsole)。
2. 进入 `Account` → `Manage group`（或 `权限管理`）。
3. 将上一步的服务账号邮箱 **添加为发布者**，角色至少为 **Publisher**（或更高）。
4. 记录你的 **Publisher ID**（在后台 `Account` 页面可见，一串字母数字）。

---

## 三、获取扩展 ID（Item ID）

1. 在开发者后台打开你的扩展商品。
2. URL 形如 `https://chrome.google.com/webstore/devconsole/<publisher-id>/<extension-id>`，
   最后一段即为 **扩展 ID**（32 位字母）。
3. 也可在已安装扩展的 `chrome://extensions/` 页面（开启开发者模式）查看 ID。

---

## 四、配置 GitHub Secrets / Variables

在仓库 `Settings` → `Environments` 中新建环境 **`chrome-web-store`**，
并为该环境配置以下变量（推荐为环境配置 **人工审批门**，避免误发布）：

| 名称 | 类型 | 说明 |
|------|------|------|
| `CWS_SERVICE_ACCOUNT_KEY` | Secret | 服务账号 JSON 私钥文件的 **完整内容** |
| `CWS_PUBLISHER_ID` | Variable | 发布商 ID |
| `CWS_EXTENSION_ID` | Variable | 扩展 ID（Item ID） |
| `CWS_PUBLISH_TARGET` | Variable | 可选，发布类型。`DEFAULT_PUBLISH`（默认，公开）或 `STAGED_PUBLISH`（先到草稿/分阶段发布） |

> 环境级 Secrets / Variables 只有在 job 进入该环境后才可见，因此 `release.yml`
> 中在步骤内做降级判断：未配置 `CWS_PUBLISHER_ID` / `CWS_EXTENSION_ID` 时跳过发布。

---

## 五、触发发布

1. 更新 `extensions/cookie-sync/manifest.json` 中的 `version`（必须大于商店当前版本）。
2. 提交并推送一个 semver tag：
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. CI 运行 `Release` 工作流：
   - `package-extension` 打包 ZIP 并上传为 artifact；
   - `release` 将 ZIP 附加到 GitHub Release；
   - `publish-extension`（需人工审批环境）上传 ZIP 到 Chrome Web Store 并提交审核。

> 扩展版本与桌面端版本解耦：桌面端发版时若扩展 `manifest.json` 版本未变，
> 打包出的 ZIP 版本号不变，商店会因版本相同而拒绝上传——这是预期行为，
> 只有真正修改了扩展代码时才需要更新 `manifest.json` 版本。

---

## 六、审核状态

Chrome Web Store 的审核是 **异步** 的，CI 提交后无法绕过或加速。
可在开发者后台查看审核进度，审核通过后扩展会自动上架（或按 `CWS_PUBLISH_TARGET`
进入分阶段发布）。
