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
- **VPN** — a toolbar toggle that routes your traffic through the Tor network, so sites and anyone watching the connection see Tor's exit point instead of your real IP/location. Free (no server to pay for — Tor is volunteer-run), no account. Requires Tor installed (`brew install tor` / `sudo apt install tor`); the button tells you if it's missing. First connect takes up to ~60-90s while Tor builds its relay cache; after that it's fast. WebRTC is also hardened against leaking your real IP while a proxy is active.
- **Daily ad-skip report** — Settings → Privacy & Shield shows today's blocked-ad count live, plus a rough "what you'd have made watching them" estimate (clearly a guess, not real data). `scripts/daily-ad-report.js` can also open a pre-filled email draft with the same numbers.

## Installing (everyone else)

No Node.js, no terminal, no build step. Grab the file for your OS from the [Releases page](https://github.com/Ismailhasan09/Gushu_Browser/releases) and run it:

- **Windows** — `Gushu-Browser-Setup.exe` (installer) or the portable `.exe`
- **macOS** — `.dmg`, then drag Gushu Browser into Applications
- **Linux** — `.AppImage` (make it executable and run it) or `.deb`

macOS note: since the app isn't notarized/signed by Apple, the first launch may be blocked by Gatekeeper. Right-click the app → Open, then confirm.

## Running from source (developers)

Requires [Node.js](https://nodejs.org) (includes npm).

```bash
git clone https://github.com/Ismailhasan09/Gushu_Browser.git
cd Gushu_Browser
npm install
npm start
```

`npm install` pulls in Electron (not stored in the repo — it's large and fully reinstallable). After that, `npm start` launches the browser.

### Building installers yourself

```bash
npm run dist:mac    # .dmg + .zip
npm run dist:win    # .exe installer + portable .exe
npm run dist:linux  # .AppImage + .deb
```

Output lands in `release/`. Pushing a tag like `v0.1.0` also triggers [GitHub Actions](.github/workflows/build.yml) to build all three platforms natively and attach them to a GitHub Release automatically.

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

Everything — history, bookmarks, settings, profiles, the cached blocklists — is stored locally in `~/Library/Application Support/Gushu Browser/` (macOS; `%APPDATA%\Gushu Browser` on Windows, `~/.config/Gushu Browser` on Linux). Nothing is sent anywhere except the page requests a normal browser makes, the periodic blocklist refresh (from easylist.to / the public hosts-list source), and live search suggestions (skipped entirely in Private windows).
