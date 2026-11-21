<div align="center">

# MiraLite

### Media Reimagined // 微光成影

简体中文 | [English](README.en.md)

<br>

![status](https://img.shields.io/badge/status-开发预览-blue?style=for-the-badge)
![license](https://img.shields.io/badge/license-MIT-green?style=for-the-badge)
![stars](https://img.shields.io/github/stars/Simqiqi/MiraLite?style=for-the-badge&color=yellow)

<br>

![tauri](https://img.shields.io/badge/Tauri-v2-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)
![react](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=white)
![platform](https://img.shields.io/badge/platform-macOS-black?style=for-the-badge&logo=apple&logoColor=white)

<br>

![typescript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![contributors](https://img.shields.io/github/contributors/Simqiqi/MiraLite?style=for-the-badge&color=orange)

<br>

![last commit](https://img.shields.io/github/last-commit/Simqiqi/MiraLite?style=for-the-badge&label=last%20commit)
![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=for-the-badge)

<br>

[项目简介](#项目简介) · [这一版做了什么](#这一版做了什么) · [完整功能](#完整功能) · [获取与运行](#获取与运行) · [技术说明](#技术说明) · [合规声明](#合规声明)

</div>

---

## 项目简介

一个桌面端的影视播放器：把 **IPTV**、**本地媒体库**与 **CAT/TVBox 聚合站点**收进同一个窗口。基于 Tauri v2 + React 19 构建，Rust 侧负责拉起 CAT 引擎、代理 TMDB 数据与转发串流，前端负责**液态玻璃**视觉、**3D 轮播首页**与**追剧清单**。

内置 CAT/TVBox spider 引擎，可直接浏览、搜索并播放聚合站点的影视资源；影视线索来自 TMDB，实际播放仍由用户自行连接的来源提供。

推荐使用猫源   https://9280.kstore.vip/cat/index.js.md5

<!-- 截图就位后取消注释，把图片放到 resources/screenshots/ 下即可
<div align="center">

<br>

<img src="./resources/screenshots/home.png" alt="首页 · 3D 轮播与热门榜单" width="90%">

*首页 · 3D 立体轮播与多榜单海报行*

<br>

<img src="./resources/screenshots/player.png" alt="播放 · 全屏播放层" width="90%">

*播放 · 全屏播放层与选集切换*

</div>
-->

## 这一版做了什么

- **关于与更新**：设置页新增「关于与更新」——显示版本号、一键检查 GitHub Release（基于公开 API，无需签名密钥），有新版本时直接给「下载安装包 / 发布说明」；仓库里也带了 tag 触发的 CI（`.github/workflows/release.yml`，push `v*` tag 自动构建 macOS 包并创建 draft Release）。
- **诊断与运维**：可查看运行日志、一键导出诊断包（应用信息 + 运行环境 + 源/收藏数量 + 最近日志，写到下载目录）；短剧缓存可在设置里看到占用并一键清理。
- **短剧运行环境**：检测系统 Node，没有再提供「下载内置运行时」（官方 tar.gz 装到应用目录，约 40MB），装好后短剧 sidecar 自动改用内置 Node，不再依赖开发环境。
- **M3U 源补节目单（XMLTV）**：片源表单新增「XMLTV 节目单地址」（支持 `.xml` 与 `.xml.gz`，Rust 侧自动 gunzip），直播页会把节目按 `tvg-id` 对上频道，显示「正在播 / 下一档 / 当天节目单」，和 Xtream 的 EPG 走同一套缓存与界面。
- **多屏同看**：直播页新增「多屏」视图，2×2 四路同时播放，点哪格哪格出声，可以给任意格子选台或随机换一组。
- **频道号与分组**：频道卡左侧显示频道号（点数字即可自定义），播放页数字键按**频道号**直达而不是下标；频道墙在「全部」下按分组分区，分组标题可折叠。
- **成人频道过滤**：设置新增「内容过滤」，内置词 + 自定义屏蔽词，命中即隐藏。
- **云端同步（WebDAV）**：设置 → 数据里填 WebDAV 地址与账号（坚果云 / Nextcloud / 群晖都行），可测试连通、上传备份、从云端恢复。
- **短剧追更**：剧集详情可关注，之后分集数变多会发系统通知；短剧页顶部显示关注列表。
- **短剧离线队列**：抽屉里可以「下载前 20 集 / 全部」，sidecar 串行下载并把 CENC 解密后的 mp4 落到本地缓存，队列面板实时显示进度、失败原因，已完成的可直接点播；被上游限流时会自动换匿名设备继续。
- **短剧进度与连播**：记住每部剧看到第几集第几秒，短剧页顶部出现「继续观看」横排；「从头连播」会把整季塞进播放队列，一集结束自动准备并播放下一集。
- **片头片尾跳过**：播放器控制条上有「片头 / 片尾」两个标记按钮（快捷键 `[` `]`），片头标记后自动跳过，片尾到了会弹出「跳过片尾 · 下一集」。
- **播放队列**：片库剧集抽屉新增「整季连播」，短剧支持整季连播；播放页显示「下一个：xxx」，按 `N` 或自动连播，短剧下一集会先本地解密再播。
- **短剧并入 ⌘K**：浏览过的短剧会缓存到本地，⌘K 里能直接搜到并跳到对应剧集详情。
- **短剧页（免费）**：侧栏新增「短剧」，走本机 sidecar（Node + 开源 [openhongguo](https://github.com/beilunyang/openhongguo) 匿名设备，免登录、免付费）。上新 / 搜索 / 详情 / 分集直接浏览；点某一集时由 sidecar 下载分片、用内容密钥本地解密（红果是 CENC 加密），再交给内置播放器播放，缓存留在 `~/Library/Caches/com.miralite.app/short-drama`。
- **直链/本地文件播放**：播放器支持 `mode=url`，http(s) 或本地 asset 文件都能直接播。
- **外部播放器**：装了 IINA / VLC 时，播放页多一个按钮，直接丢给外部播放器打开——WebKit 播不了的 MKV、特殊编码都能看。
- **直播回看**：节目单里已经播完的节目，支持回看的频道会出现「回看」按钮，自动按面板的 timeshift 地址起播。
- **节目提醒**：节目单里未开播的节目可以设提醒，开播前 5 分钟弹系统通知。
- **片库进度**：点播电影有了稳定 ID，看一半退出会记住位置，片库顶部出现「继续观看」横排，点开直接续播；海报上也有进度条。
- **更快的手**：直播页数字键直接输入频道序号（回车跳台，1.5 秒自动提交）；任意页面 ⌘1～⌘6 在 首页 / 追剧 / 直播 / 片库 / 我的 / 设置 之间切换。
- **片库（Xtream 点播 / 剧集）**：侧栏新增「片库」，按分类筛选、搜片名；电影点开直接播，剧集点开右滑出季集面板，选集即播。列表会话内缓存 20 分钟，多个 Xtream 源可在右上角切换；播放不落库，地址由播放页用源凭据现场拼接。
- **大横幅与榜单的小心思**：hero 右侧竖排 4 张「接下来」缩略图，点一下直接切过去；高分榜前 10 张海报加了超大描边序号，做出编辑精选的 Top 10 感。
- **首页氛围再上一层**：大横幅加了轻微视差（滚动时背景比内容慢）；每次换片会从 backdrop 采样主色，带动整页环境光平滑过渡；鼠标移动还有一层极淡的聚光，玻璃面板边缘的高光会跟着扫过。
- **首页做细了**：海报悬停会浮起并展开简介与「找可播线路」；榜单行支持左右翻页、两端渐隐；继续观看改成 16:9 横版大卡并显示「还剩 N 分钟」；首屏加载换成海报骨架屏；区块标题加了细分隔线与字距，大横幅标题换成衬线体。
- **液态玻璃展示页（`/glass`）**：把整套材质摊开——三种玻璃密度、按钮与胶囊、输入框、胶囊导航、折射海报卡，外加一个「光晕实验室」：拖动色相 / 模糊 / 流速滑杆，实时看玻璃背后的彩色光斑如何流动与折射；右上角还能一键换掉全局环境色。入口在 设置 → 外观，或 ⌘K 搜「液态玻璃」。
- **「我的」页**：侧栏新增入口，收藏（片单 + 收藏频道）与历史（继续观看 + 最近频道）两个 tab 一页看完。以前星标点了没处看，现在有了落脚点，也能在页内直接取消收藏、清空进度。
- **⌘K 全局搜索**：任何页面按 ⌘K 唤出浮层，一框搜直播频道、本地片库、最近观看与最近搜索，选中直接开播/进详情；回车还能把关键词丢给 CAT 跨站搜。
- **频道体检**：直播页点「体检」，Rust 侧用 6 秒超时逐个探测频道，失效的标红沉底、可一键隐藏，换台时也会自动跳过 6 小时内检出失效的频道。
- **配置备份 / 恢复**：设置 → 数据里一键把源、收藏、追剧、观看进度、CAT 订阅与脚本导出成 JSON（写到下载目录，不含缓存）；换机或重装后选备份文件即可覆盖恢复并自动刷新。
- **睡眠定时器**：播放器里选 15/30/60/90 分钟，倒计时显示在控制条上，到点自动暂停并提示，适合看直播睡着。
- **直播更好用了**：频道可以收藏（收藏排前、可按「收藏」筛选）、自动记录最近看过的 8 个频道、播放页 ↑↓ 直接换台；新增「时间轴」视图，按频道排当天节目表，金色竖线标出当前时间，点节目就能开播。
- **播放器增强**：本地视频会自动找同名字幕（`movie.srt` / `movie.chs.srt`，支持 srt / ass / ssa / vtt，自动识别 UTF-8 / GBK，ASS 只保留对白），字幕可切换或一键关闭；点播支持画中画；直播断流会退避重连（最多 6 次）并在画面上提示状态，不再一动就黑屏。
- **直播页 + 节目单（EPG）**：接入 Xtream 账号后频道直接按分类铺成频道墙，每张卡片会显示「正在播 / 进度条 / 下一档」，点「节目单」可以看到当天完整节目表并直接开播。节目单按频道缓存 15 分钟，切页回来不用重新拉；面板的节目名/简介常是 base64，已经在 Rust 侧统一解码。
- **Xtream 走真正的 player_api**：不再只是拿 `get.php?type=m3u_plus` 拼一条播放列表，而是用 `player_api.php` 拉账号信息、直播分类、频道列表（顺带 `stream_id` / `epg_channel_id` / 回看天数），播放地址统一走 `live/{user}/{pass}/{id}.m3u8`。VOD、剧集、EPG 的接口也都接好了，留给后续的点播/剧集页。
- **抓取搬到 Rust 侧**：播放列表、Xtream 接口、EPG 都由 Rust 发出请求，webview 不再受面板 CORS 限制；顺带加了 20 秒超时和 12MB 响应上限，面板抽风时不会把内存吃满。
- **液态玻璃**：每次启动随机生成一组色相，底层彩色光晕缓慢流动；侧栏、顶栏、设置面板、输入框、卡片与按钮统一为半透明玻璃材质（背景模糊 + 高光边缘 + 彩色折射），播放区保持纯黑以免干扰画面。
- **电影感大横幅首页**：顶部换成整幅背景图 + 片名 / 年份 / 评分 / 简介，主按钮直接「找可播线路」，12 秒自动换片，右下角是胶囊式计数与翻页；下方榜单行收细，标题带数量，说明文字移到右侧，层次更清楚。
- **追剧清单**：播放 CAT 剧集自动记入本地清单，记录看到第几集、哪个站点、何时更新；支持「继续追」回详情选集、星标收藏、移除与清空，首页热门也能一键加入。
- **统一搜索**：顶栏一个输入框同时检索「本地 / 频道」与「CAT 跨站真实影视」，结果分区展示；CAT 部分并发多站点、按相关度排序，可再跳 CAT 搜索页看全部命中。
- **多订阅源即时切换**：可保存多个 CAT 订阅（本地 `miralite.cat.subscriptions.v1`，兼容旧单地址自动迁移），每条可改名删除，点「选择 / 使用中」立刻生效；「测试」按钮用**独立临时引擎**实测站点数与搜索命中，不干扰正在使用的源。
- **串流代理**：本地 `:9989` 逐层改写 m3u8、透传鉴权 header、支持 Range 拖动与慢启动容错，解决 CAT 直链被 CDN 判为盗链的 403。

## 完整功能

- 极简左侧导航（首页 / 追剧 / 直播 / 片库 / 短剧 / 我的 / 设置，⌘1～⌘7 快捷切换，菜单整体下移避开 macOS 红绿灯）+ 顶部搜索 + ⌘K 全局搜索浮层
- 短剧：红果上新 / 搜索 / 详情 / 分集、离线下载队列、继续观看、整季连播（本地 CENC 解密，免费无账号）
- 片库：Xtream 点播电影 / 剧集，分类筛选、搜片名、剧集季集抽屉、多源切换、继续观看与续播
- 我的：收藏（片单 + 收藏频道）、历史（继续观看 + 最近看过的频道）
- 直播页：M3U 源 XMLTV 节目单、多屏同看（2×2）、频道号自定义与分组折叠、成人频道过滤、频道墙按分类筛选、搜频道、收藏与最近观看、频道体检（失效标红/隐藏/换台自动跳过）、EPG 正在播/下一档、当天节目单抽屉、时间轴视图（多频道节目表 + 当前时间线）、回看标记
- 首页：电影感大横幅（背景图 + 简介 + 找线路，12 秒轮换，视差滚动、主色驱动环境光、右侧缩略图导航）+ 继续观看（16:9 横版大卡）+ TMDB 多榜单横向海报行（正在热映 / 热门电影 / 热门剧集 / 高分经典 / 高分剧集）；海报悬停展开简介，榜单行可左右翻页，高分榜带 Top 10 描边序号，首屏有骨架屏
- CAT 页（保留路由）：站点清单、分类浏览、跨站并发搜索、网盘登录引导、免登录站点筛选
- CAT 详情页：多线路 + 选集、自动换线兜底、鉴权 header 透传播放
- 电影页 / 剧集页（保留路由）：类型筛选、排序、观看进度条
- 播放器：hls.js 自适应 + 断流自动重连、自定义控制条、进度回写、外部播放器打开（IINA / VLC）、键盘快捷键（空格 / ←→ / M / Esc，直播 ↑↓ 或数字键换台）、本地同名字幕切换（srt / ass / vtt，自动识别 GBK）、画中画、睡眠定时器、外部播放器
- 设置页（含外观 → 液态玻璃展示页）：
  - 播放：自动连播、优先画质
  - 推荐：TastePrint 开关
  - 片源：CAT 订阅管理、网盘配置中心、M3U / Xtream / 本地目录三类接入（M3U 可附 XMLTV 地址补节目单）、已连接源管理（Xtream 账号会先校验再导入，并自动带出直播分类与 EPG）
  - 数据：配置备份 / 恢复（JSON）、WebDAV 云端同步、内容过滤、片单、观看记录清空
- 已连接并打包 `.app` / `.dmg`

## 获取与运行

```bash
export PATH=/usr/local/bin:$PATH   # 使用系统 node v24，不要用 Marvis 内置 node
npm install

npm run dev     # 开发预览 http://127.0.0.1:5173
npm run build   # 产物输出到 dist/
```

> ⚠️ 本机 Marvis 内置的 node 带企业签名，无法 dlopen adhoc 签名的原生模块（rollup / rolldown 会直接崩）。
> 必须用系统 node 跑，否则 `npm run dev` 与 `npm run build` 都会失败。

打包：

```bash
export PATH="$HOME/.cargo/bin:/usr/local/bin:$PATH"   # Rust + 系统 node
npx tauri build --bundles app                        # 产物 src-tauri/target/release/bundle/macos/MiraLite.app
```

前端资源由 Tauri 嵌入二进制，**改动前端或 Rust 都必须重新 `tauri build`** 才会进入 `.app`。

## 技术说明

### 技术栈

| 层 | 选型 |
| --- | --- |
| 前端 | React 19 + TypeScript + Vite 7 |
| 样式 | Tailwind CSS v4（`@theme` 自定义设计令牌） |
| 路由 | react-router-dom（HashRouter，便于 Tauri 打包后直出） |
| 播放 | HTML5 video + hls.js（Safari 走原生 HLS） |
| 状态 | 轻量 `useSyncExternalStore` store，localStorage 持久化 |
| 影视元数据 | TMDB（Rust 代理 `api.tmdb.org`，Key 存本地配置；内置真实数据快照兜底） |
| 桌面壳 | Tauri v2（Rust），已接入并打包 `.app` / `.dmg` |

### 目录结构

```
src/
  components/   Shell 导航壳、SourcesSection 片源区块、TmdbSection 影视数据源设置、PlayerOverlay 全屏播放层、Poster/Row
  data/         演示数据（电影/剧集/频道）+ tmdbSnapshot（TMDB 真实榜单快照，离线兜底）
  lib/          types / store / catalog / m3u / net（文本抓取）/ xtream（Xtream API）/ epg（节目单）/ cat（CAT IPC 封装）/ catSession（多订阅源·热门·跨站搜索）/ tmdb / chase（追剧清单）
  pages/        Home / Chase / Live / Library / Short / Me / Glass / Movies / TV / Cat / CatSearch / CatDetail / Player / Detail / Search / Settings
src-tauri/
  src/lib.rs           Tauri 命令注册与启动
  src/cat.rs           CAT 引擎拉起与按订阅地址哈希隔离缓存、cat_proxy、cat_probe（:9988 等，避开流代理 :9989）
  src/tmdb.rs          TMDB 榜单代理（api.tmdb.org）、Key 本地配置、连接测试
  src/stream_proxy.rs  本地串流代理（:9989），HLS 改写 + 鉴权 header 透传 + Range
  src/xtream.rs        Xtream player_api（账号/分类/直播/VOD/剧集/EPG）+ 文本抓取代理
```

### TMDB 榜单缓存与网络

TMDB 榜单一天只更新几次，没必要每次进首页都并发拉 5 个接口。`src/lib/tmdb.ts` 做了「内存 + localStorage」双缓存（键 `miralite.tmdb.rankings.v1`，TTL 6 小时，按地址 / 语言 / Key 指纹隔离）：

- 缓存新鲜时进首页零网络请求、秒开；
- 过期时先用旧数据渲染，后台静默刷新并无缝换上新数据（stale-while-revalidate）；
- 并发调用共享同一个请求（in-flight 去重），请求失败保留旧缓存；
- 改 Key 或点右上角刷新按钮会重新拉取。

官方 `api.themoviedb.org` 在国内被 DNS 污染不可达，实际使用官方备用域名 `api.tmdb.org`（AWS CloudFront，实测可达）。Key 支持 v3 api_key 或 v4 Bearer Token（设置页的 TMDB 配置入口已隐藏，配置能力仍保留在 Rust 侧），只存本机 `~/Library/Application Support/com.miralite.app/tmdb.json`（权限 600），不进源码 / 二进制。未配置 Key、请求失败或浏览器预览时，自动回退到内置的 TMDB 真实数据快照。

### CAT 播放链路与鉴权 header

CAT 站点的 `/play` 接口返回的直链常带一组**必需的鉴权 header**（`Referer` / `Cookie` / `User-Agent`），缺少它们会被 CDN 判为盗链返回 403。播放链路完整透传这组 header：

```
catPlay() → { url, header }
  → PlayerOverlay(url, header)
  → viaProxy(url, header) → 127.0.0.1:9989/s?u=<url>&h=<JSON header>
  → Rust stream_proxy 解析 h，覆盖默认 Referer/UA，透传给上游与每个 m3u8 分片
```

`h` 参数中的 hop-by-hop 头（host / connection / content-length / range 等）会被代理过滤，避免破坏流式转发。

### Xtream 与 EPG

```
xtreamLogin() → user_info / server_info（auth、status、到期时间、可用格式）
fetchXtreamChannels() → get_live_categories + get_live_streams
  → MediaItem{ streamId, epgChannelId, tvArchive, group=分类名 }
  → 播放地址 live/{user}/{pass}/{stream_id}.m3u8
loadEpg() → get_simple_data_table（Rust 10 分钟内存缓存 + 前端 15 分钟 localStorage）
  → pickNowNext() 算「正在播 / 下一档 / 进度」
```

- 面板返回的 `title` / `description` 常是 base64，Rust 侧先按 base64 解一次，解不出来或解出乱码就保留原文。
- 部分面板只对部分频道提供 EPG，拿不到时卡片会退化成显示分类名，不会报错。
- 前端只给 Xtream 源拉 EPG（M3U 源没有账号凭据），批量拉取限并发 2，避免把面板连接数打满。

## 待办路线

- 本地媒体库刮削：多候选手动纠正、海报墙缓存落盘（同名字幕已支持）
- 直播回看 / 时移（`tv_archive` 字段已拿到）
- Windows / Linux 打包与自动更新

## 合规声明

本项目不提供任何内容源，仅作为客户端读取用户自行连接的来源；所有观看记录与设置仅保存在本机。

## 许可证

本项目采用 [MIT](LICENSE) 许可证，可自由使用、修改与分发，保留版权与许可声明即可。
