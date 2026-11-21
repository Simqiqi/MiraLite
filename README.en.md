<div align="center">

# MiraLite

### Media Reimagined

[简体中文](README.md) | English

<br>

![status](https://img.shields.io/badge/status-dev%20preview-blue?style=for-the-badge)
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

[Overview](#overview) · [What's in this release](#whats-in-this-release) · [Features](#features) · [Build & Run](#build--run) · [Technical Notes](#technical-notes) · [Compliance](#compliance)

</div>

---

## Overview

A desktop media player that puts **IPTV**, **your local media library**, and **CAT/TVBox aggregator sites** into one window. Built on Tauri v2 + React 19: the Rust side boots the CAT engine, proxies TMDB data and forwards the stream; the frontend carries the liquid-glass look, the 3D coverflow home and the watchlist.

The CAT/TVBox spider engine is built in, so you can browse, search and play titles from aggregator sites directly. Metadata comes from TMDB; playback still comes from sources you connect yourself.

<!-- Drop screenshots into resources/screenshots/ and uncomment
<div align="center">

<br>

<img src="./resources/screenshots/home.png" alt="Home · 3D coverflow and ranking rows" width="90%">

*Home · 3D coverflow and multi-ranking poster rows*

<br>

<img src="./resources/screenshots/player.png" alt="Player · full-screen overlay" width="90%">

*Player · full-screen overlay and episode switching*

</div>
-->

## What's in this release

- **About & updates**: a new settings section showing the version and checking GitHub Releases on demand (public API, no signing keys), with direct links to the installer and release notes. The repo also ships a tag-driven CI workflow that builds the macOS bundle and opens a draft release.
- **Diagnostics**: view runtime logs, export a diagnostics bundle (app info, environment, source/watchlist counts, recent logs) to Downloads, and see/clear the short-drama cache from settings.
- **Short-drama runtime**: detects a system Node and otherwise offers a one-click download of an official Node runtime into the app directory, so the sidecar no longer depends on a dev environment.
- **XMLTV guides for M3U sources**: the source form gained an "XMLTV URL" field (`.xml` and `.xml.gz` both work — Rust gunzips automatically), and the live page matches programmes to channels by `tvg-id`, sharing the same cache and UI as Xtream's EPG.
- **Multi-view**: a new "multi" mode on the live page plays four channels in a 2×2 grid — click a tile to make it the audible one, and assign channels per tile or shuffle the set.
- **Channel numbers and grouping**: each card shows its channel number (click the number to customise it), digit keys on the player jump by that number, and the channel wall groups channels under collapsible category headers.
- **Adult-channel filter**: a Content filtering section with built-in words plus your own blocklist.
- **WebDAV cloud sync**: store your backup on your own cloud (Jianguoyun / Nextcloud / Synology) and restore it on another machine.
- **Short-drama follow**: follow a series and get a system notification when new episodes appear.
- **Short-drama offline queue**: from the drawer you can queue "first 20" or "all" episodes; the sidecar downloads and CENC-decrypts them one by one into a local cache, with a live progress panel and direct playback of finished items. If upstream rate-limits, it rotates the anonymous device and keeps going.
- **Short-drama progress and binge play**: per-series resume (episode + second) with a "continue watching" row, plus "play from the start" that loads the whole season into the play queue and auto-advances.
- **Intro/outro skip**: mark the intro end and outro start from the player bar (or `[` `]`); the intro is skipped automatically and the outro offers a "skip · next episode" action.
- **Play queue**: "play whole season" in the library series drawer and for short dramas; the player shows the next item and advances on `N` or when an episode ends.
- **Short dramas in ⌘K**: browsed titles are cached locally so the palette can find and open them.
- **Short-drama page (free)**: a new sidebar entry backed by a local sidecar (Node + the open-source [openhongguo](https://github.com/beilunyang/openhongguo) anonymous SDK — no login, no fees). New releases, search, details and episode lists browse freely; picking an episode downloads the segment and decrypts it locally with the content key (Hongguo uses CENC), then hands the file to the built-in player. Cache lives in `~/Library/Caches/com.miralite.app/short-drama`.
- **Local/direct playback**: the player accepts `mode=url` for both http(s) links and local asset files.
- **External players**: with IINA or VLC installed, the player gains a button that hands the stream to it — MKV and unusual codecs that WebKit refuses now play fine.
- **Live catch-up**: programmes in the guide that already aired become playable for channels that support archive, starting from the panel's timeshift URL.
- **Programme reminders**: set a reminder on any upcoming programme and get a system notification five minutes before it starts.
- **Library progress**: VOD movies now have a stable id, so quitting halfway remembers the position; the library shows a "continue watching" row and posters carry progress bars.
- **Faster hands**: type a channel number on the live page to jump straight to it (Enter to confirm, auto-commits after 1.5s), and ⌘1–⌘6 switch between Home / Watchlist / Live / Library / Me / Settings.
- **Library (Xtream VOD / series)**: a new sidebar entry with category filters and title search. Movies play on click; series slide out a season/episode panel and start from any episode. Listings cache for 20 minutes per session, multiple Xtream sources switch from the corner, and playback URLs are assembled in the player from the source credentials instead of being persisted.
- **Hero and row details**: four small "up next" posters stack on the right of the hero and switch on click; the top-rated rows stamp their first ten posters with oversized outlined rank numbers for an editorial Top 10 feel.
- **More atmosphere on Home**: the hero now parallaxes gently against scroll, samples a dominant colour from each backdrop to retint the app's ambient glow, and a very faint cursor spotlight sweeps the glass edges as the pointer moves.
- **Home polish**: posters lift and reveal their overview plus a "find a route" hint on hover; ranking rows page left/right with masked edges; continue-watching became 16:9 cards with "N min left"; the first paint uses poster-shaped skeletons; section headers gained a hairline divider and letter-spacing, and the hero title switched to a serif face.
- **Liquid-glass showcase (`/glass`)**: the whole material system laid out — three glass densities, buttons and chips, inputs, a capsule nav, refracting poster cards, plus a "glow lab" where hue, blur and flow speed sliders drive live coloured blobs behind a glass panel. A button in the corner rerolls the app-wide ambient palette. Reach it from Settings → Appearance or by searching "liquid glass" in ⌘K.
- **A "Me" page**: a new sidebar entry collecting favourites (watchlist plus favourited channels) and history (continue watching plus recent channels) behind two tabs, with inline unfavourite, remove and clear actions.
- **⌘K global search**: press ⌘K anywhere to open a palette that searches live channels, the local library, recents and recent queries in one box — pick a result to play or open it, or hit Enter to hand the term to CAT for cross-site search.
- **Channel health check**: the live page can probe channels one by one (6s timeout, done in Rust). Dead ones are dimmed and sorted last, can be hidden with one click, and zapping skips anything found dead in the last six hours.
- **Config backup / restore**: Settings → Data exports sources, favourites, watchlist, progress, CAT subscriptions and userscripts to a JSON file in Downloads (caches excluded); restore from that file after a reinstall and the UI reloads automatically.
- **Sleep timer**: pick 15/30/60/90 minutes in the player, see the countdown in the control bar, and playback pauses with a toast when it hits zero.
- **Live, improved**: favourite channels (pinned to the front and filterable), the last eight channels you watched, and ↑/↓ zapping in the player. A new timeline view lays the day's programmes out per channel with a gold "now" line — click any programme to start it.
- **Player upgrades**: local videos automatically pick up sibling subtitles (`movie.srt`, `movie.chs.srt`; srt / ass / ssa / vtt, UTF-8 or GBK auto-detected, ASS keeps dialogue only), switchable or one-tap off; picture-in-picture for on-demand; live streams reconnect with backoff (up to six attempts) and show status instead of going black.
- **Live page + EPG**: an Xtream account now turns into a channel wall grouped by category. Each card shows what is on now, a progress bar and the next programme; the "guide" button opens the full day's schedule and can start playback from there. Schedules are cached per channel for 15 minutes, and base64-encoded titles/descriptions from panels are decoded on the Rust side.
- **Xtream now uses the real player_api**: instead of only building a `get.php?type=m3u_plus` playlist, MiraLite reads account info, live categories and streams via `player_api.php` (keeping `stream_id` / `epg_channel_id` / archive days) and plays through `live/{user}/{pass}/{id}.m3u8`. VOD, series and EPG endpoints are wired up as well, ready for the upcoming on-demand pages.
- **Fetching moved to Rust**: playlists, Xtream endpoints and EPG all go through Rust, so the webview is no longer blocked by panel CORS, with a 20s timeout and a 12MB response cap to keep memory in check.
- **Liquid glass**: a fresh hue set on every launch, with a coloured haze drifting underneath. Sidebar, top bar, settings panel, inputs, cards and buttons all share translucent glass (backdrop blur, specular edge, coloured refraction), while the video area stays pure black so it never competes with the picture.
- **Cinematic hero home**: a full-bleed backdrop with title, year, rating and overview, a primary "find a playable route" action, twelve-second auto-rotation, plus a capsule counter and pager in the corner. Ranking rows are tightened up with counts in the heading and helper text moved to the right.
- **Watchlist**: playing a CAT series records it locally — which episode, which site, when it updated. "Continue" jumps back to the detail page to pick the next episode; star, remove or clear from the list, and add titles from the home page in one tap.
- **Unified search**: one box searches local content and channels together with CAT cross-site titles, results shown in sections. The CAT part fans out across sites concurrently and ranks by relevance, with a link to the full CAT search page.
- **Multiple subscriptions, instant switching**: several CAT sources are stored in `miralite.cat.subscriptions.v1` (an old single address migrates automatically). Rename or delete each entry, and "select / in use" switches the active source immediately — home rankings, search and playback all follow it. The "test" button spins up a separate temporary engine to measure site count and search hits without touching the source you are using.
- **Stream proxy**: a local `:9989` proxy rewrites m3u8 playlists layer by layer, forwards auth headers, supports Range seeking and tolerates slow starts — fixing the 403s you get when a CDN treats CAT direct links as hotlink abuse.

## Features

- Minimal left nav (Home / Watchlist / Live / Library / Short / Me / Settings, ⌘1–⌘7 shortcuts; shifted down to clear the macOS traffic lights) plus top search and the ⌘K global palette
- Short drama: Hongguo new releases / search / details / episodes, offline download queue, resume and binge play (local CENC decryption, free, no account)
- Library: Xtream VOD movies / series with category filters, search, a season-episode drawer, source switching, continue-watching and resume
- Me: favourites (watchlist + favourited channels) and history (continue watching + recent channels)
- Live page: XMLTV guides for M3U sources, multi-view (2×2), custom channel numbers with collapsible groups, adult filter, category filter, channel search, favourites and recents, health check (dim/hide dead channels, zapping skips them), EPG now/next, full-day guide drawer, timeline view, archive badge
- Home: cinematic hero (backdrop + overview + find-a-route, rotating every twelve seconds, parallax, backdrop-driven ambient tint, thumbnail strip), continue watching as 16:9 cards, then TMDB poster rows for In Theatres / Popular Movies / Popular TV / Top Rated Movies / Top Rated TV; posters reveal their overview on hover, rows page left/right, top-rated rows carry outlined Top 10 numbers, and the first paint is skeleton-based
- CAT page (route kept for home links): site list, category browsing, concurrent cross-site search, cloud-drive login guide, no-login-only site filter
- CAT detail: multiple routes plus episode list, automatic route fallback, auth-header passthrough playback
- Movies / TV pages (routes kept, not in the menu): genre filter, sorting, progress bar
- Player: hls.js adaptive streaming with auto-reconnect, custom control bar, progress write-back, keyboard shortcuts (Space / ←→ / M / Esc, ↑↓ or number keys to zap on live), local subtitle switching (srt / ass / vtt, GBK aware), picture-in-picture, sleep timer, external player hand-off
- Settings:
  - Playback: auto-play next, preferred quality
  - Recommendations: TastePrint toggle
  - Sources:
    - CAT subscriptions: multiple sources saved locally, rename and delete, instant switching between them, "test" using an isolated temporary engine, and the active subscription warms up on launch
    - Cloud-drive setup, M3U / Xtream / local folder onboarding (Xtream is validated before import and brings categories plus EPG), connected source management
  - Data: config backup / restore (JSON), WebDAV sync, content filtering, clear watchlist and watch history
- Built and packaged as `.app` / `.dmg`

## Build & Run

```bash
export PATH=/usr/local/bin:$PATH   # use the system node v24, not the node bundled with Marvis
npm install

npm run dev     # dev preview at http://127.0.0.1:5173
npm run build   # output in dist/
```

> ⚠️ The node bundled with Marvis on this machine carries an enterprise signature and cannot `dlopen` adhoc-signed native modules (rollup / rolldown crash outright). You have to run on the system node, otherwise both `npm run dev` and `npm run build` fail.

Packaging:

```bash
export PATH="$HOME/.cargo/bin:/usr/local/bin:$PATH"   # Rust + system node
npx tauri build --bundles app                        # output: src-tauri/target/release/bundle/macos/MiraLite.app
```

Frontend assets are embedded into the binary by Tauri, so **any change to the frontend or to Rust needs a fresh `tauri build`** before it reaches the `.app`.

## Technical Notes

### Stack

| Layer | Choice |
| --- | --- |
| Frontend | React 19 + TypeScript + Vite 7 |
| Styling | Tailwind CSS v4 (`@theme` design tokens) |
| Routing | react-router-dom (HashRouter, so a Tauri bundle can serve routes directly) |
| Playback | HTML5 video + hls.js (native HLS on Safari) |
| State | Lightweight `useSyncExternalStore` store, persisted to localStorage |
| Metadata | TMDB (Rust proxy to `api.tmdb.org`, key stored locally; bundled real-data snapshot as fallback) |
| Shell | Tauri v2 (Rust), wired up and packaged as `.app` / `.dmg` |

### Layout

```
src/
  components/   Shell nav, SourcesSection, TmdbSection, PlayerOverlay, Poster/Row
  data/         demo data (movies / series / channels) + tmdbSnapshot (real TMDB ranking snapshot, offline fallback)
  lib/          types / store / catalog / m3u / net (text fetching) / xtream (Xtream API) / epg (programme guide) / cat (CAT IPC wrapper) / catSession (multi-source · trending · cross-site search) / tmdb / chase
  pages/        Home / Chase / Live / Movies / TV / Cat / CatSearch / CatDetail / Player / Detail / Search / Settings
src-tauri/
  src/lib.rs           Tauri command registration and startup
  src/cat.rs           CAT engine startup, per-subscription-address hashed cache, cat_proxy, cat_probe (:9988, kept off the stream proxy's :9989)
  src/tmdb.rs          TMDB ranking proxy (api.tmdb.org), local key config, connection test
  src/stream_proxy.rs  Local stream proxy (:9989), HLS rewriting + auth header passthrough + Range
  src/xtream.rs        Xtream player_api (account / categories / live / VOD / series / EPG) + text fetch proxy
```

### TMDB rankings cache and network

TMDB rankings only refresh a few times a day, so there is no point firing five requests every time the home page opens. `src/lib/tmdb.ts` keeps a memory + localStorage double cache (key `miralite.tmdb.rankings.v1`, TTL 6 hours, isolated by address / language / key fingerprint):

- Fresh cache means zero network requests and an instant home page.
- Expired cache still renders the old data first, refreshes silently in the background and swaps in the new data seamlessly (stale-while-revalidate).
- Concurrent callers share one in-flight request, and a failed request keeps the old cache.
- Changing the key, or hitting the refresh button in the top-right corner, triggers a refetch.

The official `api.themoviedb.org` is DNS-poisoned and unreachable from mainland China, so the app uses the official alternate domain `api.tmdb.org` (AWS CloudFront, verified reachable). A v3 api_key or v4 Bearer Token is supported (the TMDB config entry is hidden from Settings; the capability stays in Rust) and the key is stored only on this machine at `~/Library/Application Support/com.miralite.app/tmdb.json` (mode 600) and never lands in the source tree or the binary. With no key, a failed request, or a browser preview, the app falls back to the bundled real TMDB snapshot.

### CAT playback chain and auth headers

Direct links returned by a CAT site's `/play` endpoint usually carry a set of **required auth headers** (`Referer` / `Cookie` / `User-Agent`); without them the CDN treats the request as hotlink abuse and returns 403. The playback chain forwards that header set end to end:

```
catPlay() → { url, header }
  → PlayerOverlay(url, header)
  → viaProxy(url, header) → 127.0.0.1:9989/s?u=<url>&h=<JSON header>
  → Rust stream_proxy parses h, overrides the default Referer/UA, and passes it upstream to every m3u8 segment
```

Hop-by-hop headers in the `h` parameter (host / connection / content-length / range, etc.) are filtered out by the proxy so they cannot break streaming.

## Roadmap

- Local library scraping: manual candidate correction and a persisted poster wall cache
- Live time-shift / catch-up (`tv_archive` is already available)
- Windows / Linux packaging and auto-update

## Compliance

This project ships no content sources of its own. It is a client that reads sources the user connects; every watch record and setting stays on the local machine.

## License

Released under the [MIT](LICENSE) license — free to use, modify and redistribute, provided the copyright and permission notice are kept.
