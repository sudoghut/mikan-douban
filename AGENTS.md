# AGENTS.md

给在本仓库工作的 AI agent / 协作者的速记。记录项目结构、发布流程，以及**已经踩过的坑**，避免重复。

## 项目是什么

一个 Tampermonkey / Violentmonkey **用户脚本**：在 [蜜柑计划](https://mikanani.me/) 首页给每部番剧卡片加一个「豆」徽标，点击跳转豆瓣（优先解析 subject 直链，失败回退搜索）。

- 全部逻辑就在单文件 **`mikan-douban.user.js`**，没有构建步骤、没有依赖、没有 `package.json`。直接改这个文件即可。
- 关键实现点：豆瓣 `subject_suggest` 接口 + 标题归一化匹配；`GM_xmlhttpRequest`（`@connect movie.douban.com`）；串行节流队列防反爬；`IntersectionObserver` 懒加载 + `MutationObserver` 适配首页动态加载；30 天缓存（仅对真·无结果做负缓存）。

## 发布流程（改动后怎么发版）

发版 = **改代码 + 抬高脚本头里的 `@version` + `git push` 到 `master`**。其余自动：

1. **GitHub Action**（`.github/workflows/release.yml`）：push 到 master 且改动包含 `mikan-douban.user.js` 时触发，读脚本头的 `@version`，若 `v<version>` tag 不存在就自动建 Release 并附上 `.user.js`。
2. **Greasy Fork**（已发布：<https://greasyfork.org/zh-CN/scripts/584821>）：设为 **Automatic** 同步，源是 `master` 分支的 raw 文件；配了 GitHub webhook，push 后会即时重新拉取。

> ⚠️ **必须每次抬高 `@version`**：否则 Action 不会建 Release（tag 已存在），油猴客户端也不会认为有更新。版本号是整条链路的唯一"开关"。

## 已踩过的坑（重要）

### 1. Greasy Fork webhook 返回 403 → 是 **Secret 不匹配**，不是 Cloudflare 拦截
- 症状：GitHub webhook 投递一直 `403`，响应头是 `Server: cloudflare` / `text/html`，**容易误判成 Cloudflare WAF 拦截**。实际上 GF 整站在 Cloudflare 后面，那个 403 是 **GF 应用层**因签名校验失败返回的。
- 根因：Greasy Fork 给每个账号生成了一个 **webhook Secret**（见 GF 的 "Setting up a webhook" 页面）。GitHub webhook 必须填**同一个 Secret**，GitHub 才会用它算 HMAC 签名（`X-Hub-Signature-256`），GF 用同一把密钥校验。**GitHub 端 Secret 留空 → 签名对不上 → 403。**
- 解法：把 GF 页面上显示的那串 Secret 原样填进 GitHub webhook 的 Secret 字段（`config.secret`）。填完立刻变 `200`。
- 验证手段：`gh api repos/<owner>/<repo>/hooks/<id>/deliveries` 看 `status_code`；可用 `gh api -X POST .../deliveries/<delivery_id>/attempts` 重投已有的投递来重试，不必为测试而反复 push。
- Secret 本身**不要 commit 进仓库**——它只存在于 GitHub webhook 配置（只写、不回显）和 GF 账号里。即便泄露，爆炸半径也极小：最多让人伪造 push 事件触发 GF 重新同步你这个本就公开的脚本，拿不到仓库写权限。

### 2. webhook 只在 push **真正改动了被同步的文件**时才会让 GF 更新
- 只改 `README.md` / 文档的 push，不会更新 GF 上的脚本（GF 只对 push 里被 modified 的同步文件动作）。要更新脚本必须改 `mikan-douban.user.js` 本身。
- 对应地，不想触发 Release 的纯文档改动是安全的：Action 的 `paths` 过滤只认 `mikan-douban.user.js`。

### 3. Windows + Git Bash 下 `gh api` 的路径被改写
- 在 Git Bash（本机默认）里 `gh api /repos/...`（**带前导斜杠**）会被 shell 当成文件系统路径改写，导致请求打到 `C:/Program Files/Git/repos/...`，**静默失败**（之前建 webhook 第一次就因此没建成，且没有报错）。
- 解法：`gh api` 的 endpoint **不要带前导斜杠** —— 用 `gh api repos/<owner>/<repo>/hooks`。

### 4. 同步兜底，不必依赖 webhook
- 即使 webhook 不通，GF 的 **Automatic** 同步会定期自查；也可在脚本页手动点 **Sync** 立即拉取。webhook 只是让更新"秒级"。
- 排查 GF 当前版本：`https://api.greasyfork.org/en/scripts/584821.json` 的 `version` 字段（注意该接口/CDN 可能有缓存延迟，刚 push 完不一定立刻反映）。

## 环境备注
- 仓库本地路径在 OneDrive 下；`git` 会提示 `LF will be replaced by CRLF`，属正常（仓库内存 LF）。
- `gh` 已登录账号 `sudoghut`，token scopes 含 `repo`（足够管理 webhook）、`workflow`。
