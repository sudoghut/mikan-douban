# 蜜柑计划 → 豆瓣 链接 (mikan-douban)

> 在 [蜜柑计划 / Mikan Project](https://mikanani.me/) 首页，为每部番剧优雅地附上一个跳转到 **豆瓣** 的链接。

一个轻量的 Tampermonkey / Violentmonkey 用户脚本：在蜜柑首页每张番剧卡片右上角加一个「豆」徽标，点击即可跳转豆瓣。脚本会尝试把它解析成豆瓣 **subject 直链**（命中条目页），解析失败时自动回退到 **豆瓣搜索**，保证随时可点。

## 截图

![蜜柑首页每张番剧卡片上的「豆」徽标](docs/screenshot.png)

> 灰色「豆」= 豆瓣搜索兜底；绿色「豆」= 已解析到豆瓣条目直链。

## 功能特性

- 🟢 **直链优先**：调用豆瓣 `subject_suggest` 接口，按「精确同名 → 包含关系 → 第一条」挑选最佳条目，命中则徽标变绿并跳转条目页。
- 🔍 **搜索兜底**：解析失败/无结果时，徽标始终保留豆瓣搜索链接，永远可点。
- 💾 **本地缓存**：结果缓存 30 天（含版本前缀，便于将来失效）。仅对「真·无结果」做负缓存；超时/反爬/解析错误不缓存，下次可重试。
- 🐌 **节流防封**：串行请求队列 + 相邻请求最小间隔（默认 400ms）+ 单请求超时看门狗，避免触发豆瓣反爬。
- 👀 **懒加载**：使用 `IntersectionObserver`，番剧卡片进入可视区后才发起请求。
- 🔁 **动态适配**：`MutationObserver` 监听首页列表变化，翻页 / 异步加载的新卡片也会自动装饰。
- 🧩 **同名合并**：同一标题的多个徽标只发一次请求，结果分发给所有等待者。

## 安装

1. 安装用户脚本管理器：[Tampermonkey](https://www.tampermonkey.net/) 或 [Violentmonkey](https://violentmonkey.github.io/)。
2. 安装本脚本：
   - **(推荐)** 从 Greasy Fork 安装：*(发布后填入链接)*
   - 或手动：打开 [`mikan-douban.user.js`](./mikan-douban.user.js) 的 raw 文件，脚本管理器会自动识别并提示安装。
3. 打开 [https://mikanani.me/](https://mikanani.me/) 即可看到每部番剧卡片上的「豆」徽标。

## 工作原理

| 颜色 | 含义 |
|------|------|
| 灰色「豆」 | 尚未解析 / 解析失败，点击 → 豆瓣**搜索** |
| 绿色「豆」 | 已解析到豆瓣条目，点击 → 豆瓣**条目直链**（悬停显示豆瓣标题与年份） |

脚本仅在蜜柑首页 (`https://mikanani.me/`) 运行，通过 `GM_xmlhttpRequest` 跨域访问 `movie.douban.com`，并用 `GM_getValue/GM_setValue` 存储缓存。

## 配置

脚本顶部 `配置` 区可调：

| 常量 | 默认值 | 说明 |
|------|--------|------|
| `CACHE_TTL` | 30 天 | 缓存有效期 |
| `REQUEST_GAP` | 400ms | 相邻豆瓣请求的最小间隔 |
| `REQUEST_TIMEOUT` | 12000ms | 单次请求超时 |

## 隐私说明

脚本不收集任何数据。所有请求直接发往豆瓣，缓存仅存在你本地浏览器（脚本管理器存储）。

## 同类脚本

据 [Greasy Fork](https://greasyfork.org/en/scripts/by-site/mikanani.me) 现状，蜜柑上已有显示 **Bangumi（番组计划）** 评分的脚本（如「蜜柑计划增强整合版」「Mikan-bgm-rating」），但本脚本是面向 **豆瓣** 的，数据源不同、用途互补。

## 许可证

[MIT](./LICENSE)
