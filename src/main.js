const { app, BrowserWindow, Menu, ipcMain, session, shell, net, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn, execFileSync } = require('child_process');
const { readJSON, writeJSON } = require('./store');
const CURATED_AD_DOMAINS = require('./adblock-list');

const IS_MAC = process.platform === 'darwin';
const { loadBlocklist } = require('./blocklist');
const { loadFilterLists } = require('./easylist');

const pageOverlayCSS = fs.readFileSync(path.join(__dirname, 'page-overlay.css'), 'utf8');
const googleLogoCSS = fs.readFileSync(path.join(__dirname, 'google-logo.css'), 'utf8');

// Populated once EasyList/EasyPrivacy finish loading (see bottom of file).
// Hides ad containers/overlays that are part of a page's own HTML rather
// than a separate blockable network request — the fake-"browser window"
// scam-ad category included.
let cosmeticCSS = '';

// Chromium's native dark-mode renderer (same tech behind Chrome's own
// "Auto dark mode for web contents" flag): it intelligently flips each
// site's backgrounds/text while leaving photos/images alone, so every
// page reads dark instead of clashing with the space-themed chrome.
// Must be set before app is ready.
app.commandLine.appendSwitch('force-dark-mode');
app.commandLine.appendSwitch('enable-features', 'WebContentsForceDark');

// Without this, a page can use WebRTC to ask the OS for its real local/
// public IP directly — bypassing the VPN/Tor proxy entirely, even while
// it's active. This forces WebRTC to only ever see the proxied route.
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

// The packaged app's name is "Gushu Browser" (see package.json
// productName), which would otherwise move Electron's default userData
// folder away from the "my-browser" one this app used before packaging
// existed. Pin the path explicitly and migrate any pre-existing data
// over once, so nobody's history/bookmarks/profiles appear to vanish.
const oldUserDataDir = path.join(app.getPath('appData'), 'my-browser');
const userDataDir = path.join(app.getPath('appData'), 'Gushu Browser');
if (!fs.existsSync(userDataDir) && fs.existsSync(oldUserDataDir)) {
  fs.renameSync(oldUserDataDir, userDataDir);
}
app.setPath('userData', userDataDir);
const HISTORY_LIMIT = 2000;

// ---------- profiles ----------
// Each profile is a fully separate identity: its own history, bookmarks,
// downloads, ad-block setting, and (via a dedicated session partition)
// its own cookies/cache. "default" reuses the plain top-level files this
// app already had before profiles existed, so nothing already on disk
// moves or breaks; every other profile gets its own subfolder.

const profilesIndexPath = path.join(userDataDir, 'profiles.json');
let profiles = readJSON(profilesIndexPath, []);
if (profiles.length === 0) {
  profiles = [{ id: 'default', name: 'Default', color: '#22d3ee', createdAt: Date.now() }];
  writeJSON(profilesIndexPath, profiles);
}

function profileDir(id) {
  if (id === 'default') return userDataDir;
  const dir = path.join(userDataDir, 'profiles', id);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const profileStores = new Map();
function storeFor(profileId) {
  const id = profiles.some((p) => p.id === profileId) ? profileId : 'default';
  if (profileStores.has(id)) return profileStores.get(id);

  const dir = profileDir(id);
  const files = {
    settings: path.join(dir, 'settings.json'),
    history: path.join(dir, 'history.json'),
    bookmarks: path.join(dir, 'bookmarks.json'),
    downloads: path.join(dir, 'downloads.json'),
    blockedDaily: path.join(dir, 'blocked-daily.json'),
  };
  let blockedDailySaveTimer = null;
  const store = {
    settings: readJSON(files.settings, { adBlockEnabled: true, anthropicApiKey: '' }),
    history: readJSON(files.history, []),
    bookmarks: readJSON(files.bookmarks, []),
    downloads: readJSON(files.downloads, []),
    blockedCount: 0,
    blockedByDomain: {},
    // Keyed by local date ("YYYY-MM-DD") so the daily-report script can
    // read today's count directly, without Electron, even with the app
    // closed. Unlike blockedCount/blockedByDomain above (session-only),
    // this is written to disk — but debounced, since ad-block hits can
    // fire hundreds of times per page load.
    blockedDaily: readJSON(files.blockedDaily, {}),
    // Ephemeral, session-only — not written to disk, cleared on restart
    // (same as real browsers' "recently closed tabs").
    recentlyClosed: [],
    saveSettings() {
      writeJSON(files.settings, store.settings);
    },
    saveHistory() {
      writeJSON(files.history, store.history);
    },
    saveBookmarks() {
      writeJSON(files.bookmarks, store.bookmarks);
    },
    saveDownloads() {
      writeJSON(files.downloads, store.downloads);
    },
    saveBlockedDaily() {
      writeJSON(files.blockedDaily, store.blockedDaily);
    },
    recordBlockedToday() {
      const today = todayKey();
      store.blockedDaily[today] = (store.blockedDaily[today] || 0) + 1;
      if (blockedDailySaveTimer) return;
      blockedDailySaveTimer = setTimeout(() => {
        blockedDailySaveTimer = null;
        store.saveBlockedDaily();
      }, 5000);
    },
  };
  profileStores.set(id, store);
  return store;
}

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function sessionForProfile(profileId) {
  return profileId === 'default' ? session.defaultSession : session.fromPartition(`persist:profile-${profileId}`);
}

// ---------- ad blocking ----------

// Starts with the small hand-curated list so blocking works immediately
// at launch, then gets the ~70k-domain fetched blocklist merged in once
// it loads (see loadBlocklist() call near the bottom of this file).
const blockedHosts = new Set(CURATED_AD_DOMAINS);

// Walks up the domain hierarchy (ads.sub.example.com -> sub.example.com ->
// example.com) checking each level against the Set, so a single lookup is
// O(hostname depth) rather than O(list size) — matters once the list has
// tens of thousands of entries.
function matchAdDomain(urlStr) {
  let hostname;
  try {
    hostname = new URL(urlStr).hostname;
  } catch {
    return null;
  }
  let h = hostname;
  while (h) {
    if (blockedHosts.has(h)) return h;
    const dot = h.indexOf('.');
    if (dot === -1) return null;
    h = h.slice(dot + 1);
  }
  return null;
}

ipcMain.handle('ad-block:is-blocked-url', (_e, profileId, url) => {
  const store = storeFor(profileId);
  if (!store.settings.adBlockEnabled) return false;
  return !!matchAdDomain(url);
});

// webRequest.onBeforeRequest replaces any previous listener on a session
// rather than stacking, and session.on('will-download') is a real
// multi-listener EventEmitter — both get a WeakSet guard so re-running
// setup on an already-handled session is a safe no-op instead of either
// silently replacing logic or double-counting downloads.
const adBlockSessions = new WeakSet();
function registerAdBlock(ses, profileId) {
  if (adBlockSessions.has(ses)) return;
  adBlockSessions.add(ses);
  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const store = storeFor(profileId);
    const matched = store.settings.adBlockEnabled ? matchAdDomain(details.url) : null;
    if (matched) {
      store.blockedCount += 1;
      store.blockedByDomain[matched] = (store.blockedByDomain[matched] || 0) + 1;
      store.recordBlockedToday();
      callback({ cancel: true });
    } else {
      callback({ cancel: false });
    }
  });
}

const downloadSessions = new WeakSet();
function registerDownloads(ses, profileId) {
  if (downloadSessions.has(ses)) return;
  downloadSessions.add(ses);
  ses.on('will-download', (_event, item) => {
    const store = storeFor(profileId);
    const entry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      filename: item.getFilename(),
      url: item.getURL(),
      savePath: '',
      state: 'progressing',
      receivedBytes: 0,
      totalBytes: item.getTotalBytes(),
      startedAt: Date.now(),
    };
    store.downloads.unshift(entry);

    item.on('updated', (_e, state) => {
      entry.state = state;
      entry.receivedBytes = item.getReceivedBytes();
    });

    item.once('done', (_e, state) => {
      entry.state = state;
      entry.savePath = item.getSavePath();
      entry.completedAt = Date.now();
      store.saveDownloads();
    });
  });
}

function setupProfileSession(profileId) {
  const ses = sessionForProfile(profileId);
  registerAdBlock(ses, profileId);
  registerDownloads(ses, profileId);
  if (vpnState === 'on') applyVpnToSession(ses);
  return ses;
}

// ---------- VPN (Tor) ----------
// Routes traffic through the Tor network instead of a VPN we'd have to
// run ourselves: it's free forever (thousands of volunteer-run relays,
// not a server we pay for), and it's specifically built for "nobody can
// trace where this connection came from" — multiple relays hop the
// traffic, so no single party sees both who you are and what you're
// visiting. No account, no server to operate, no shared secret baked
// into the app (each run picks its own anonymous circuit).

const TOR_SOCKS_PORT = 9152;
const torDataDir = path.join(userDataDir, 'tor-data');

let torProcess = null;
let vpnState = 'off'; // 'off' | 'connecting' | 'on'
let resolvedTorPath = null;

function resolveTorPath() {
  if (resolvedTorPath) return resolvedTorPath;
  const candidates = ['tor', '/opt/homebrew/bin/tor', '/usr/local/bin/tor', '/usr/bin/tor', '/usr/sbin/tor'];
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'ignore' });
      resolvedTorPath = candidate;
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function startTor() {
  return new Promise((resolve, reject) => {
    const torPath = resolveTorPath();
    if (!torPath) {
      reject(
        new Error(
          process.platform === 'darwin'
            ? 'Tor isn’t installed. Install it with "brew install tor", then try again.'
            : process.platform === 'linux'
            ? 'Tor isn’t installed. Install it with "sudo apt install tor" (or your distro’s package manager), then try again.'
            : 'Tor isn’t installed. Install the Tor Expert Bundle from torproject.org, then try again.'
        )
      );
      return;
    }

    fs.mkdirSync(torDataDir, { recursive: true });
    const proc = spawn(torPath, ['--SocksPort', String(TOR_SOCKS_PORT), '--DataDirectory', torDataDir, '--Log', 'notice stdout'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    torProcess = proc;

    // The very first bootstrap (building the relay descriptor cache from
    // scratch) can take 60-90s depending on the network; later ones reuse
    // the cached torDataDir and are much faster, usually a few seconds.
    const timeout = setTimeout(() => {
      cleanup();
      proc.kill();
      reject(new Error('Tor took too long to connect. Check your network and try again.'));
    }, 90000);

    function cleanup() {
      clearTimeout(timeout);
      proc.stdout?.removeAllListeners('data');
      proc.removeAllListeners('exit');
    }

    proc.stdout?.on('data', (chunk) => {
      if (chunk.toString().includes('Bootstrapped 100%')) {
        cleanup();
        resolve();
      }
    });
    proc.on('exit', (code) => {
      cleanup();
      torProcess = null;
      reject(new Error(`Tor exited unexpectedly (code ${code}).`));
    });
    proc.on('error', (err) => {
      cleanup();
      torProcess = null;
      reject(err);
    });
  });
}

function stopTor() {
  if (torProcess) {
    torProcess.kill();
    torProcess = null;
  }
}

async function applyVpnToSession(ses) {
  if (vpnState === 'on') {
    await ses.setProxy({ proxyRules: `socks5://127.0.0.1:${TOR_SOCKS_PORT}` });
  } else {
    await ses.setProxy({ mode: 'direct' });
  }
}

async function applyVpnToAllSessions() {
  await applyVpnToSession(session.defaultSession);
  for (const p of profiles) {
    await applyVpnToSession(sessionForProfile(p.id));
  }
  for (const wc of webContents.getAllWebContents()) {
    if (wc.getType() === 'webview') await applyVpnToSession(wc.session);
  }
}

function broadcastVpnState() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('vpn-state-changed', vpnState);
  }
}

ipcMain.handle('vpn:get-state', () => vpnState);

ipcMain.handle('vpn:enable', async () => {
  if (vpnState === 'on') return { state: vpnState };
  if (vpnState === 'connecting') return { state: vpnState };
  vpnState = 'connecting';
  broadcastVpnState();
  try {
    await startTor();
    vpnState = 'on';
    await applyVpnToAllSessions();
    broadcastVpnState();
    return { state: vpnState };
  } catch (err) {
    vpnState = 'off';
    stopTor();
    broadcastVpnState();
    return { state: vpnState, error: err.message || 'Could not start the VPN.' };
  }
});

ipcMain.handle('vpn:disable', async () => {
  vpnState = 'off';
  stopTor();
  await applyVpnToAllSessions();
  broadcastVpnState();
  return { state: vpnState };
});

function createWindow({ private: isPrivate = false, profileId = 'default' } = {}) {
  if (!isPrivate) setupProfileSession(profileId);

  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 640,
    minHeight: 420,
    // 'hiddenInset' (native traffic lights with our tab strip wrapped
    // around them) is macOS-only; Chromium/Electron has no equivalent on
    // Windows/Linux, so those platforms get the normal native title bar
    // instead of a broken half-custom one.
    titleBarStyle: IS_MAC ? 'hiddenInset' : undefined,
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  });
  win.profileId = profileId;

  // Native macOS trackpad gesture (System Settings > Trackpad > More
  // Gestures > "Swipe between pages" must be on — this is an OS-level
  // setting we can't control from the app). Direction here is the
  // gesture's own direction, not the navigation result, so the mapping
  // is reversed: swiping right pulls the previous page in from the left.
  win.on('swipe', (_event, direction) => {
    if (direction === 'left') {
      win.webContents.send('menu-action', 'go-forward');
    } else if (direction === 'right') {
      win.webContents.send('menu-action', 'go-back');
    }
  });

  const query = { profile: profileId };
  if (isPrivate) query.private = '1';
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query });
  return win;
}

function sendMenuAction(action) {
  return (_menuItem, window) => {
    const win = window || BrowserWindow.getFocusedWindow();
    win?.webContents.send('menu-action', action);
  };
}

function buildMenu() {
  const profileItems = profiles.map((p) => ({
    label: `Open — ${p.name}`,
    click: () => createWindow({ profileId: p.id }),
  }));

  // macOS convention is a first submenu named after the app, holding
  // About/Settings/Quit. There's no equivalent slot on Windows/Linux, so
  // those platforms get Settings folded into File and About into Help
  // instead, rather than an empty/non-functional app-name menu.
  const menu = Menu.buildFromTemplate([
    ...(IS_MAC
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: sendMenuAction('settings') },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', click: sendMenuAction('new-tab') },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: (_item, win) => createWindow({ profileId: win?.profileId || 'default' }) },
        { label: 'New Private Window', accelerator: 'CmdOrCtrl+Shift+N', click: () => createWindow({ private: true }) },
        { type: 'separator' },
        { label: 'Close Tab', click: sendMenuAction('close-tab') },
        { role: 'close' },
        ...(IS_MAC
          ? []
          : [
              { type: 'separator' },
              { label: 'Settings...', accelerator: 'CmdOrCtrl+,', click: sendMenuAction('settings') },
              { role: 'quit' },
            ]),
      ],
    },
    {
      label: 'Profiles',
      submenu: [...profileItems, { type: 'separator' }, { label: 'Manage Profiles...', click: sendMenuAction('settings') }],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find in Page', accelerator: 'CmdOrCtrl+F', click: sendMenuAction('find') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: sendMenuAction('reload') },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Alt+R', click: sendMenuAction('force-reload') },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { label: 'Reader Mode', accelerator: 'CmdOrCtrl+Shift+R', click: sendMenuAction('reader-mode') },
        { label: 'Enter Picture in Picture', click: sendMenuAction('pip') },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: sendMenuAction('zoom-in') },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: sendMenuAction('zoom-out') },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: sendMenuAction('zoom-reset') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Show History', click: sendMenuAction('history') },
        { label: 'Delete Browsing Data...', accelerator: 'CmdOrCtrl+Shift+Backspace', click: sendMenuAction('delete-browsing-data') },
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: sendMenuAction('toggle-bookmark') },
        { label: 'Show Bookmarks', click: sendMenuAction('bookmarks') },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Downloads', accelerator: 'Alt+CmdOrCtrl+L', click: sendMenuAction('downloads') },
        { label: 'Privacy Report', click: sendMenuAction('privacy') },
        { label: 'Print...', accelerator: 'CmdOrCtrl+P', click: sendMenuAction('print') },
      ],
    },
    ...(IS_MAC ? [] : [{ label: 'Help', submenu: [{ role: 'about' }] }]),
  ]);
  Menu.setApplicationMenu(menu);
}

buildMenu();

ipcMain.handle('ad-block:get', (_e, profileId) => storeFor(profileId).settings.adBlockEnabled);
ipcMain.handle('ad-block:set', (_e, profileId, value) => {
  const store = storeFor(profileId);
  store.settings.adBlockEnabled = Boolean(value);
  store.saveSettings();
  return store.settings.adBlockEnabled;
});
ipcMain.handle('ad-block:count', (_e, profileId) => storeFor(profileId).blockedCount);

// ---------- Ask Gushu (Claude API) ----------
// Uses the user's own Anthropic API key, stored locally — each request is
// billed to whoever's key is set, so there's nothing shared/embedded here.

ipcMain.handle('ask-gushu:get-key', (_e, profileId) => storeFor(profileId).settings.anthropicApiKey || '');
ipcMain.handle('ask-gushu:set-key', (_e, profileId, key) => {
  const store = storeFor(profileId);
  store.settings.anthropicApiKey = key || '';
  store.saveSettings();
  return store.settings.anthropicApiKey;
});

ipcMain.handle('ask-gushu:send', async (_e, profileId, { messages, pageContext }) => {
  const key = storeFor(profileId).settings.anthropicApiKey;
  if (!key) return { error: 'No API key set. Add one in Settings → Ask Gushu.' };

  const body = {
    model: 'claude-sonnet-5',
    max_tokens: 1024,
    messages,
  };
  if (pageContext) {
    body.system = `You're helping the user understand the web page they currently have open. Use this page content to answer when relevant. Keep answers concise.\n\nPage title: ${pageContext.title}\nPage URL: ${pageContext.url}\nPage content:\n${pageContext.text}`;
  }

  try {
    const res = await net.fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) return { error: data?.error?.message || `Request failed (${res.status}).` };
    const text = data.content?.find((block) => block.type === 'text')?.text || '';
    return { text };
  } catch (err) {
    return { error: err.message || 'Request failed.' };
  }
});

// A rough estimate only — there's no way to know what any real ad
// actually pays. Roughly mid-range for typical display-ad CPMs
// ($1-$3 per 1000 views). Keep this in sync with scripts/daily-ad-report.js.
const RATE_PER_AD = 0.002;

ipcMain.handle('privacy:report', (_e, profileId) => {
  const store = storeFor(profileId);
  const byDomain = Object.entries(store.blockedByDomain)
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count);
  const todayCount = store.blockedDaily[todayKey()] || 0;
  return { total: store.blockedCount, byDomain, today: { count: todayCount, estimate: todayCount * RATE_PER_AD } };
});

ipcMain.handle('history:add', (_e, profileId, { url, title, favicon }) => {
  const store = storeFor(profileId);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  store.history.push({ id, url, title: title || url, favicon: favicon || null, visitedAt: Date.now() });
  if (store.history.length > HISTORY_LIMIT) store.history = store.history.slice(store.history.length - HISTORY_LIMIT);
  store.saveHistory();
});
ipcMain.handle('history:list', (_e, profileId) => [...storeFor(profileId).history].reverse());
ipcMain.handle('history:remove', (_e, profileId, id) => {
  const store = storeFor(profileId);
  const idx = store.history.findIndex((h) => h.id === id);
  if (idx === -1) return null;
  const [removed] = store.history.splice(idx, 1);
  store.saveHistory();
  return removed;
});
ipcMain.handle('history:restore', (_e, profileId, entry) => {
  // Undo for a single removal — put it back in chronological position.
  const store = storeFor(profileId);
  let insertAt = store.history.findIndex((h) => h.visitedAt > entry.visitedAt);
  if (insertAt === -1) insertAt = store.history.length;
  store.history.splice(insertAt, 0, entry);
  store.saveHistory();
});
ipcMain.handle('history:clear', (_e, profileId) => {
  const store = storeFor(profileId);
  store.history = [];
  store.saveHistory();
});

// Ephemeral "recently closed tabs" — in-memory only, per profile, never
// written to disk (cleared on app restart, same as real browsers).
ipcMain.handle('tabs:closed-list', (_e, profileId) => storeFor(profileId).recentlyClosed);
ipcMain.handle('tabs:notify-closed', (_e, profileId, entry) => {
  const store = storeFor(profileId);
  store.recentlyClosed.unshift({ ...entry, closedAt: Date.now() });
  if (store.recentlyClosed.length > 10) store.recentlyClosed.length = 10;
});

// Groups history by domain and ranks by visit count (ties broken by most
// recent) — the classic "frequently visited" tile set most browsers show
// on a fresh new-tab page before you've bookmarked anything.
ipcMain.handle('history:top-sites', (_e, profileId, limit = 10) => {
  const store = storeFor(profileId);
  const byHost = new Map();

  for (const entry of store.history) {
    let host;
    try {
      host = new URL(entry.url).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    const existing = byHost.get(host);
    if (existing) {
      existing.count += 1;
      if (entry.visitedAt > existing.visitedAt) {
        existing.visitedAt = entry.visitedAt;
        existing.url = entry.url;
        existing.title = entry.title;
        existing.favicon = entry.favicon || existing.favicon;
      }
    } else {
      byHost.set(host, { host, url: entry.url, title: entry.title, favicon: entry.favicon || null, count: 1, visitedAt: entry.visitedAt });
    }
  }

  return [...byHost.values()]
    .sort((a, b) => b.count - a.count || b.visitedAt - a.visitedAt)
    .slice(0, limit);
});

ipcMain.handle('bookmarks:toggle', (_e, profileId, { url, title, favicon }) => {
  const store = storeFor(profileId);
  const idx = store.bookmarks.findIndex((b) => b.url === url);
  const nowBookmarked = idx === -1;
  if (nowBookmarked) {
    store.bookmarks.unshift({ url, title: title || url, favicon: favicon || null, createdAt: Date.now() });
  } else {
    store.bookmarks.splice(idx, 1);
  }
  store.saveBookmarks();
  return nowBookmarked;
});
ipcMain.handle('bookmarks:is', (_e, profileId, url) => storeFor(profileId).bookmarks.some((b) => b.url === url));
ipcMain.handle('bookmarks:list', (_e, profileId) => storeFor(profileId).bookmarks);
ipcMain.handle('bookmarks:remove', (_e, profileId, url) => {
  const store = storeFor(profileId);
  store.bookmarks = store.bookmarks.filter((b) => b.url !== url);
  store.saveBookmarks();
});

ipcMain.handle('downloads:list', (_e, profileId) => storeFor(profileId).downloads);
ipcMain.handle('downloads:clear', (_e, profileId) => {
  const store = storeFor(profileId);
  store.downloads = [];
  store.saveDownloads();
});
ipcMain.handle('downloads:open-folder', (_e, profileId, id) => {
  const entry = storeFor(profileId).downloads.find((d) => d.id === id);
  if (entry?.savePath) shell.showItemInFolder(entry.savePath);
});

function rangeToCutoff(range) {
  const now = Date.now();
  if (range === 'hour') return now - 60 * 60 * 1000;
  if (range === 'today') {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (range === 'week') return now - 7 * 24 * 60 * 60 * 1000;
  return 0; // 'all'
}

ipcMain.handle('browsing-data:delete', async (_e, profileId, options = {}) => {
  const { range = 'all', history: clearHistoryFlag = true, cookies = true, cache = true } = options;
  const store = storeFor(profileId);

  if (clearHistoryFlag) {
    if (range === 'all') {
      store.history = [];
    } else {
      const cutoff = rangeToCutoff(range);
      store.history = store.history.filter((h) => h.visitedAt < cutoff);
    }
    store.saveHistory();
  }

  const ses = sessionForProfile(profileId);
  // Cookies/cache don't support partial time-range clearing in Electron's
  // session API — a selected range only narrows which history entries are
  // removed, cookies/cache are cleared in full when checked at all.
  if (cookies) await ses.clearStorageData();
  if (cache) await ses.clearCache();
});

ipcMain.handle('profiles:list', () => profiles);
ipcMain.handle('profiles:create', (_e, { name, color }) => {
  const id = `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const profile = { id, name: (name || 'New Profile').slice(0, 40), color: color || '#22d3ee', createdAt: Date.now() };
  profiles.push(profile);
  writeJSON(profilesIndexPath, profiles);
  setupProfileSession(id);
  buildMenu();
  return profile;
});
ipcMain.handle('profiles:open', (_e, id) => {
  createWindow({ profileId: id });
});

// Two-finger trackpad swipe, reported by webview-preload.js. event.sender
// here is the webview's own webContents (the tab that was actually
// swiped on), so it can navigate itself directly.
ipcMain.on('gesture-navigate', (event, direction) => {
  const wc = event.sender;
  const nav = wc.navigationHistory || wc;
  if (direction === 'back' && nav.canGoBack()) nav.goBack();
  else if (direction === 'forward' && nav.canGoForward()) nav.goForward();
});

ipcMain.handle('suggest:local', (_e, profileId, query) => {
  const store = storeFor(profileId);
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const matches = [];
  const seen = new Set();

  for (const b of store.bookmarks) {
    if (matches.length >= 4) break;
    if (seen.has(b.url)) continue;
    if (b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q)) {
      matches.push({ type: 'bookmark', url: b.url, title: b.title, favicon: b.favicon });
      seen.add(b.url);
    }
  }
  for (let i = store.history.length - 1; i >= 0 && matches.length < 6; i--) {
    const h = store.history[i];
    if (seen.has(h.url)) continue;
    if (h.title.toLowerCase().includes(q) || h.url.toLowerCase().includes(q)) {
      matches.push({ type: 'history', url: h.url, title: h.title, favicon: h.favicon });
      seen.add(h.url);
    }
  }
  return matches;
});

ipcMain.handle('search:suggest', async (_e, query) => {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await net.fetch(`https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    return Array.isArray(data?.[1]) ? data[1].slice(0, 6) : [];
  } catch (err) {
    console.error('search:suggest failed:', err);
    return [];
  }
});

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;

  // Strip the "Electron/x.y.z" token so sites see a plain Chrome UA
  // instead of flagging this as a non-standard browser and serving a
  // degraded page (this is what was breaking Google search results).
  contents.setUserAgent(contents.getUserAgent().replace(/\s*Electron\/\S+/, ''));

  // Profile-backed sessions are already registered by setupProfileSession()
  // when their window was created, so these are no-ops there (guarded by
  // the WeakSets above) — this line's real job is covering private
  // windows' one-off ephemeral sessions, which aren't pre-registered
  // anywhere else. Private tabs share the Default profile's ad-block
  // setting as a baseline.
  registerAdBlock(contents.session, 'default');
  registerDownloads(contents.session, 'default');
  if (vpnState === 'on') applyVpnToSession(contents.session);

  // When a page puts a video into HTML fullscreen (the Fullscreen API),
  // Electron does NOT automatically resize our window or hide our own
  // chrome — the video just fills whatever space the webview already has
  // below the toolbar. Take the window itself fullscreen to match; the
  // renderer handles hiding the tab-strip/toolbar on the matching DOM
  // event (see renderer.js).
  contents.on('enter-html-full-screen', () => {
    BrowserWindow.fromWebContents(contents.hostWebContents)?.setFullScreen(true);
  });
  contents.on('leave-html-full-screen', () => {
    BrowserWindow.fromWebContents(contents.hostWebContents)?.setFullScreen(false);
  });

  // Layer the Gushu corner glow/accent bar over every visited site (see
  // page-overlay.css for how this stays non-interactive).
  contents.on('dom-ready', () => {
    contents.insertCSS(pageOverlayCSS).catch(() => {});

    if (cosmeticCSS && storeFor('default').settings.adBlockEnabled) {
      contents.insertCSS(cosmeticCSS).catch(() => {});
    }

    // The Google-logo swap is injected separately, and only when the
    // page actually is google.com — #logo and alt="Google" are generic
    // enough that other sites use them for their own logo too.
    let hostname = '';
    try {
      hostname = new URL(contents.getURL()).hostname;
    } catch {
      /* non-http pages (e.g. file://, about:blank) — leave hostname empty */
    }
    if (hostname === 'google.com' || hostname === 'www.google.com') {
      contents.insertCSS(googleLogoCSS).catch(() => {});
    }
  });
});

app.whenReady().then(() => {
  createWindow();

  // Fetches/refreshes the full blocklist in the background — the curated
  // list already active above keeps blocking working immediately, this
  // just makes it thorough once it lands (usually a couple seconds).
  const blocklistCachePath = path.join(userDataDir, 'blocklist-cache.txt');
  loadBlocklist(blocklistCachePath)
    .then((domains) => {
      for (const d of domains) blockedHosts.add(d);
      console.log(`Ad blocklist ready: ${blockedHosts.size} domains.`);
    })
    .catch((err) => console.error('Blocklist load failed:', err));

  // EasyList + EasyPrivacy: more network-block domains, plus the cosmetic
  // selectors that hide ad containers baked directly into a page's HTML
  // (not just a separate blockable request) — see easylist.js.
  const filterListCachePaths = [path.join(userDataDir, 'easylist-cache.txt'), path.join(userDataDir, 'easyprivacy-cache.txt')];
  loadFilterLists(filterListCachePaths)
    .then(({ domains, selectors }) => {
      for (const d of domains) blockedHosts.add(d);
      cosmeticCSS = [...selectors].map((s) => `${s}{display:none!important}`).join('\n');
      console.log(`Filter lists ready: ${blockedHosts.size} total domains, ${selectors.size} cosmetic rules.`);
    })
    .catch((err) => console.error('Filter list load failed:', err));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Flushes the debounced blocked-ad-count writes immediately, so the last
// few seconds before quitting aren't lost (the daily-report script reads
// this file directly, with the app closed).
app.on('before-quit', () => {
  for (const store of profileStores.values()) store.saveBlockedDaily();
  stopTor();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
