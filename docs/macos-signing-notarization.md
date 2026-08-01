# macOS 代码签名与公证（Notarization）配置指南

## 为什么需要签名与公证？

macOS 的 **Gatekeeper** 安全机制会拦截所有从互联网下载的、未经签名与公证的应用，
用户会看到提示：**"无法打开 FeedFlow，因为 Apple 无法检查它是否包含恶意软件"**。

要让用户能正常打开安装包，必须完成两步：

1. **代码签名（Code Signing）** — 使用 Apple 颁发的 `Developer ID Application` 证书对 `.app` 签名，
   证明应用未被篡改。
2. **公证（Notarization）** — 将签名后的应用提交给 Apple 扫描恶意软件，通过后将公证票据
   **装订（Staple）** 到安装包上，Gatekeeper 即可离线验证通过。

本项目已在 `electron-builder.yml` 和 `.github/workflows/release.yml` 中配置好签名与公证流程，
**只需在 GitHub Secrets 中填入对应的 Apple 凭据即可生效**。未配置时，CI 会自动降级为
不签名/不公证（与当前行为一致），不会构建失败。

---

## 前置条件

- 已加入 **Apple Developer Program**（$99/年）：https://developer.apple.com/programs/
- 拥有一台 Mac（导出证书需要在 macOS 上操作）

---

## 一、准备 Developer ID 证书（代码签名）

1. 打开 **Xcode** → `Settings` → `Accounts`，登录你的 Apple ID（需已加入开发者计划）。
2. 选中团队，点击 `Manage Certificates...` → 左下角 `+` → 选择 **Developer ID Application**。
3. 证书创建后，打开 **钥匙串访问（Keychain Access）**，在 `我的证书` 中找到刚创建的
   `Developer ID Application: XXX (TEAMID)`。
4. 右键该证书 → `导出...` → 格式选择 **个人信息交换 (.p12)** → 设置一个密码（记住，后面要用）。
5. 将导出的 `.p12` 文件转为 base64，用于存入 GitHub Secret：
   ```bash
   base64 -i /path/to/cert.p12 | tr -d '\n' > cert.p12.base64.txt
   ```

---

## 二、准备 App Store Connect API Key（公证）

> 推荐使用 **API Key** 方式公证，比 Apple ID + App 专用密码更稳定（不受 2FA / 密码变更影响）。

1. 登录 https://appstoreconnect.apple.com/ → `Users and Access` → `Keys`（顶部标签）。
2. 点击 `+` 生成新密钥，名称随意，**角色选择 App Manager**（或更高权限）。
3. 生成后：
   - 记录 **Key ID**（如 `ABCDE12345`）
   - 记录 **Issuer ID**（页面上方显示，UUID 格式）
   - 下载 **.p8** 私钥文件（只能下载一次，妥善保存）
4. 将 `.p8` 文件内容转为 base64：
   ```bash
   base64 -i /path/to/AuthKey_ABCDE12345.p8 | tr -d '\n' > authkey.p8.base64.txt
   ```

---

## 三、获取 Team ID

登录 https://developer.apple.com/account/ → 页面右上角 `Membership` → 找到 **Team ID**
（10 位字母数字，如 `ABCDE12345`）。

---

## 四、在 GitHub 仓库配置 Secrets

进入仓库 `Settings` → `Secrets and variables` → `Actions` → `New repository secret`，
逐个添加以下 6 个 Secret：

| Secret 名称 | 内容 | 来源 |
|---|---|---|
| `CSC_LINK_BASE64` | `.p12` 证书的 base64 字符串 | 第一步生成的 `cert.p12.base64.txt` 内容 |
| `CSC_KEY_PASSWORD` | 导出 `.p12` 时设置的密码 | 第一步设置的密码 |
| `APPLE_API_KEY_ID` | API Key ID | 第二步记录的 Key ID |
| `APPLE_API_ISSUER_ID` | Issuer ID | 第二步记录的 Issuer ID |
| `APPLE_API_KEY_P8_BASE64` | `.p8` 私钥的 base64 字符串 | 第二步生成的 `authkey.p8.base64.txt` 内容 |
| `APPLE_TEAM_ID` | Team ID | 第三步获取的 Team ID |

配置完成后，下次推送 `v*` tag 触发 Release 工作流时，macOS 构建会自动进行签名与公证。

---

## 五、验证产物是否通过公证

下载 CI 产出的 `.dmg`，在 Mac 上执行：

```bash
# 检查签名
codesign -dv --verbose=4 /Volumes/FeedFlow/FeedFlow.app

# 检查公证票据（stapled）
stapler validate /Volumes/FeedFlow/FeedFlow.app

# 模拟 Gatekeeper 评估
spctl -a -vv -t install /Volumes/FeedFlow/FeedFlow.dmg
```

`spctl` 输出应包含 `accepted` 和 `source=Notarized Developer ID`。

---

## 六、本地构建测试（可选）

在本地 Mac 上构建并签名/公证，需先把凭据写入环境变量：

```bash
# 1) 准备证书与 key 文件
export CSC_LINK=/path/to/cert.p12
export CSC_KEY_PASSWORD="你的证书密码"

# 2) 准备 API Key
export APPLE_API_KEY_ID="ABCDE12345"
export APPLE_API_ISSUER_ID="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export APPLE_API_KEY_PATH=/path/to/AuthKey_ABCDE12345.p8
export APPLE_TEAM_ID="ABCDE12345"

# 3) 构建（会自动签名 + 公证 + 装订）
npm run package:mac
```

---

## 常见问题

**Q: 公证失败，提示 "The binary is not signed"？**
A: 证书未正确注入。检查 `CSC_LINK_BASE64` / `CSC_KEY_PASSWORD` 是否正确，
以及 `electron-builder.yml` 中 `identity` 是否为 `null`（设为 null 时 electron-builder
会自动匹配钥匙串/CSC_LINK 中的证书）。

**Q: 公证失败，提示 "Team ID 不匹配"？**
A: 确保 `APPLE_TEAM_ID` 与 `Developer ID` 证书所属团队一致。

**Q: 运行时报权限错误（如无法访问网络/文件）？**
A: 检查 `resources/entitlements.mac.plist` 是否包含所需权限。
Electron 应用常见需要：`com.apple.security.network.client`、
`com.apple.security.cs.allow-jit`、`com.apple.security.cs.disable-library-validation`。

**Q: 不想付费加入开发者计划，有替代方案吗？**
A: 没有官方替代。未签名/公证的应用用户需手动右键 → 打开（仅首次），
或在终端执行 `xattr -cr /Applications/FeedFlow.app` 移除隔离属性。
但这对普通用户门槛太高，强烈建议配置签名与公证。
