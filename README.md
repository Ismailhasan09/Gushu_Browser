# Gushu Browser

A desktop web browser built with Electron (Chromium) and a fully custom interface — comet-branded, dark, built from scratch rather than skinned on top of Chrome/Edge/Brave.

## Features

- **Tabs & Tab Groups** — right-click a tab to group, rename, color, and collapse groups
- **Profiles** — fully separate identities (history, bookmarks, cookies, logins), persistent across restarts, distinct from Private windows
- **Private windows** — isolated, non-persistent session; nothing is saved
- **History, Bookmarks, Downloads** — each with its own page, all data stored locally only
- **Reader Mode** — strips a page to just the article text with Light/Sepia/Dark themes and adjustable font size
- **Find in page**, **Picture-in-Picture**, **trackpad swipe navigation** (2-finger, macOS)
- **Ad & tracker blocking** — powered by the EasyList/EasyPrivacy filter lists (the same lists real ad blockers use) plus a maintained hosts-file blocklist, totaling 150,000+ domains, with cosmetic rules that hide ad containers baked directly into a page's HTML. Also blocks popup/popunder ads outright. Toggle it from the shield in the address bar.
- **Privacy Report** — see what's been blocked, broken down by tracker network
- **Address bar suggestions** — instant matches from your own History/Bookmarks, plus live search suggestions (skipped in Private windows)
- **Fullscreen video** — takes over the whole window properly, chrome hidden
- **Start page** — Favorites grid (your bookmarks + most-visited sites), Privacy Report summary

## Requirements

- [Node.js](https://nodejs.org) (includes npm)
- macOS (the window chrome — hidden title bar, traffic-light spacing, trackpad swipe — is currently macOS-specific; it will launch on Windows/Linux but that area of the UI won't look right there)

## Running it

```bash
git clone https://github.com/Ismailhasan09/Gushu_Browser.git
cd Gushu_Browser
npm install
npm start
```

`npm install` pulls in Electron (not stored in the repo — it's large and fully reinstallable). After that, `npm start` launches the browser.

## Project structure

```
src/
  main.js              Electron main process: windows, menu, ad-block/download tracking, IPC
  preload.js            Bridge exposed to the main chrome window
  store.js               Tiny JSON read/write helper
  adblock-list.js    Hand-curated domain blocklist (baseline, always active)
  blocklist.js           Fetches/caches the hosts-file-style blocklist
  easylist.js             Fetches/parses EasyList + EasyPrivacy
  page-overlay.css  Decorative overlay injected into every visited site
  google-logo.css   Swaps Google's logo for the Gushu mark (google.com only)
  renderer/
    index.html, styles.css, renderer.js    The browser chrome (tabs, toolbar)
    start.html, start.css, start.js           New-tab page
    webview-preload.js                               Bridge exposed to internal pages
    internal/                                                 History, Bookmarks, Downloads, Privacy, Settings pages
```

## Where your data lives

Everything — history, bookmarks, settings, profiles, the cached blocklists — is stored locally in `~/Library/Application Support/my-browser/` (macOS). Nothing is sent anywhere except the page requests a normal browser makes, the periodic blocklist refresh (from easylist.to / the public hosts-list source), and live search suggestions (skipped entirely in Private windows).
