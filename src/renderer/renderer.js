// normalizeInput() comes from nav-utils.js, loaded before this file.
const PROFILE_ID = window.browserAPI.profileId;
const IS_PRIVATE = new URLSearchParams(window.location.search).get('private') === '1';
const PRIVATE_PARTITION = IS_PRIVATE ? `private-${Date.now()}-${Math.random().toString(36).slice(2)}` : null;
if (IS_PRIVATE) document.body.classList.add('private');
document.body.classList.add(window.browserAPI.platform === 'darwin' ? 'platform-mac' : 'platform-other');

function withProfile(url) {
  const u = new URL(url);
  u.searchParams.set('profile', PROFILE_ID);
  return u.href;
}

const HOME_URL = withProfile(new URL('start.html', document.baseURI).href);
const WEBVIEW_PRELOAD_URL = new URL('webview-preload.js', document.baseURI).href;

function internalUrl(name) {
  return withProfile(new URL(`internal/${name}.html`, document.baseURI).href);
}

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const tabStrip = document.getElementById('tab-strip');
const newTabBtn = document.getElementById('new-tab-btn');
const webviewContainer = document.getElementById('webview-container');
const addressBar = document.getElementById('address-bar');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');
const bookmarkBtn = document.getElementById('bookmark-btn');
const readerBtn = document.getElementById('reader-btn');
const historyBtn = document.getElementById('history-btn');
const bookmarksBtn = document.getElementById('bookmarks-btn');
const downloadsBtn = document.getElementById('downloads-btn');
const privacyBtn = document.getElementById('privacy-btn');
const settingsBtn = document.getElementById('settings-btn');
const profileBadge = document.getElementById('profile-badge');

const findBar = document.getElementById('find-bar');
const findInput = document.getElementById('find-input');
const findCount = document.getElementById('find-count');
const findPrevBtn = document.getElementById('find-prev-btn');
const findNextBtn = document.getElementById('find-next-btn');
const findCloseBtn = document.getElementById('find-close-btn');

const ctxMenu = document.getElementById('ctx-menu');
const ctxGroupList = document.getElementById('ctx-group-list');

if (!IS_PRIVATE && PROFILE_ID !== 'default') {
  window.browserAPI.getProfiles().then((profiles) => {
    const p = profiles.find((x) => x.id === PROFILE_ID);
    if (!p) return;
    profileBadge.textContent = (p.name[0] || '?').toUpperCase();
    profileBadge.title = p.name;
    profileBadge.style.setProperty('--profile-color', p.color);
    profileBadge.classList.add('visible');
  });
}

/** @type {Map<number, {id:number, webview:Electron.WebviewTag, tabEl:HTMLElement, titleEl:HTMLElement, title:string, url:string, groupId:?number, _lastHistoryUrl:?string}>} */
const tabs = new Map();
/** @type {Map<number, {id:number, name:string, color:string, collapsed:boolean}>} */
const groups = new Map();
let activeTabId = null;
let nextTabId = 1;
let nextGroupId = 1;
const GROUP_COLORS = ['#7c5cff', '#ff7a59', '#ff4fa0', '#ffc56b', '#2bc48a'];
const FAV_COLORS = ['linear-gradient(135deg,#ffc56b,#ff7a59,#ff4fa0)', '#7c5cff', '#3d7bff', '#2bc48a', '#ffb020'];
const CLOSE_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const RELOAD_ICON_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg>';
const STOP_ICON_SVG = CLOSE_ICON_SVG;

function createTab(url = HOME_URL, { activate = true } = {}) {
  closeFindBar();

  const id = nextTabId++;

  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.dataset.tabId = String(id);

  const faviconEl = document.createElement('span');
  faviconEl.className = 'tab-favicon';
  faviconEl.style.background = FAV_COLORS[id % FAV_COLORS.length];

  const titleEl = document.createElement('span');
  titleEl.className = 'tab-title';
  titleEl.textContent = 'New Tab';

  const closeEl = document.createElement('button');
  closeEl.className = 'tab-close';
  closeEl.innerHTML = CLOSE_ICON_SVG;
  closeEl.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(id);
  });

  tabEl.appendChild(faviconEl);
  tabEl.appendChild(titleEl);
  tabEl.appendChild(closeEl);
  tabEl.addEventListener('click', () => switchTab(id));

  const webview = document.createElement('webview');
  webview.setAttribute('src', url);
  webview.setAttribute('allowpopups', 'true');
  webview.setAttribute('preload', WEBVIEW_PRELOAD_URL);
  if (IS_PRIVATE) {
    webview.setAttribute('partition', PRIVATE_PARTITION);
  } else if (PROFILE_ID !== 'default') {
    webview.setAttribute('partition', `persist:profile-${PROFILE_ID}`);
  }
  webviewContainer.appendChild(webview);

  const tab = { id, webview, tabEl, titleEl, title: 'New Tab', url, favicon: null, groupId: null, _lastHistoryUrl: null };
  tabs.set(id, tab);
  renderTabStrip();

  webview.addEventListener('page-favicon-updated', (e) => {
    const url = e.favicons && e.favicons[0];
    if (!url) return;
    tab.favicon = url;
    faviconEl.style.backgroundImage = `url("${url}")`;
  });

  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    titleEl.textContent = e.title;

    if (!IS_PRIVATE && /^https?:/i.test(tab.url) && tab.url !== tab._lastHistoryUrl) {
      tab._lastHistoryUrl = tab.url;
      window.browserAPI.addHistory({ url: tab.url, title: e.title, favicon: tab.favicon });
    }
  });

  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    tab.favicon = null;
    faviconEl.style.backgroundImage = 'none';
    if (activeTabId === id) {
      syncAddressBar(tab);
      refreshBookmarkState();
      readerBtn.classList.remove('active');
    }
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url;
    if (activeTabId === id) {
      syncAddressBar(tab);
      refreshBookmarkState();
    }
  });

  webview.addEventListener('did-start-loading', () => {
    if (activeTabId === id) reloadBtn.innerHTML = STOP_ICON_SVG;
  });

  webview.addEventListener('did-stop-loading', () => {
    if (activeTabId === id) {
      reloadBtn.innerHTML = RELOAD_ICON_SVG;
      updateNavButtons();
    }
  });

  webview.addEventListener('found-in-page', (e) => {
    if (activeTabId !== id) return;
    const { activeMatchOrdinal, matches } = e.result;
    findCount.textContent = matches > 0 ? `${activeMatchOrdinal}/${matches}` : '0/0';
  });

  webview.addEventListener('new-window', async (e) => {
    // Popunder/popup ads work by hijacking clicks to fire window.open() to
    // an ad-network destination. Blocking every new-window request
    // outright (what this used to do) also ate legitimate ones — a
    // Cmd-click or right-click "open in new tab" on any normal link fires
    // the exact same event, so Google Scholar and similar real links got
    // silently swallowed too. Checking the actual destination against the
    // same blocklist used for network requests fixes that: only requests
    // headed to a known ad/tracker domain get suppressed.
    const isInternalSource = webview.getURL().startsWith('file://') && webview.getURL().includes('/renderer/internal/');
    if (!isInternalSource) {
      const blocked = await window.browserAPI.isBlockedUrl(e.url);
      if (blocked) return;
    }
    createTab(e.url);
  });

  // Hides our own chrome so a fullscreened video actually gets the full
  // window (main.js handles taking the native window itself fullscreen).
  webview.addEventListener('enter-html-full-screen', () => {
    document.body.classList.add('video-fullscreen');
  });
  webview.addEventListener('leave-html-full-screen', () => {
    document.body.classList.remove('video-fullscreen');
  });

  if (activate) switchTab(id);
  return id;
}

function switchTab(id) {
  const next = tabs.get(id);
  if (!next) return;

  if (activeTabId !== null) {
    const prev = tabs.get(activeTabId);
    if (prev) {
      prev.tabEl.classList.remove('active');
      prev.webview.classList.remove('active');
    }
  }

  activeTabId = id;
  next.tabEl.classList.add('active');
  next.webview.classList.add('active');
  syncAddressBar(next);
  updateNavButtons();
  refreshBookmarkState();
  readerBtn.classList.remove('active');
  closeFindBar();
}

function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return;

  const ids = [...tabs.keys()];
  const idx = ids.indexOf(id);
  const groupId = tab.groupId;

  // Track for "Recently closed" — skip private windows, and skip our own
  // internal/new-tab pages (nothing useful to reopen there).
  if (!IS_PRIVATE && /^https?:/i.test(tab.url)) {
    window.browserAPI.notifyTabClosed({ url: tab.url, title: tab.title, favicon: tab.favicon });
  }

  tab.tabEl.remove();
  tab.webview.remove();
  tabs.delete(id);

  if (groupId && ![...tabs.values()].some((t) => t.groupId === groupId)) {
    groups.delete(groupId);
  }

  if (tabs.size === 0) {
    createTab(HOME_URL);
    return;
  }

  renderTabStrip();

  if (activeTabId === id) {
    const fallbackIdx = Math.max(0, idx - 1);
    const fallbackId = [...tabs.keys()][Math.min(fallbackIdx, tabs.size - 1)];
    switchTab(fallbackId);
  }
}

// Rebuilds the visual order of the tab strip: grouped tabs render as a
// contiguous cluster behind a colored chip (wherever the group's first
// member currently sits), everything else stays in creation order. Tab
// elements are moved, never recreated, so listeners/state survive.
function renderTabStrip() {
  tabStrip.querySelectorAll('.tab, .group-chip').forEach((el) => el.remove());

  const rendered = new Set();
  for (const tab of tabs.values()) {
    if (rendered.has(tab.id)) continue;

    if (tab.groupId && groups.has(tab.groupId)) {
      const group = groups.get(tab.groupId);
      tabStrip.insertBefore(buildGroupChip(group), newTabBtn);

      for (const t of tabs.values()) {
        if (t.groupId !== group.id) continue;
        rendered.add(t.id);
        t.tabEl.classList.add('grouped');
        t.tabEl.style.setProperty('--tab-group-color', group.color);
        if (!group.collapsed) tabStrip.insertBefore(t.tabEl, newTabBtn);
      }
    } else {
      tab.tabEl.classList.remove('grouped');
      tab.tabEl.style.removeProperty('--tab-group-color');
      tabStrip.insertBefore(tab.tabEl, newTabBtn);
      rendered.add(tab.id);
    }
  }
}

function buildGroupChip(group) {
  const chip = document.createElement('div');
  chip.className = 'group-chip';
  chip.style.setProperty('--group-color', group.color);
  chip.innerHTML = `<span class="group-dot"></span><span class="group-name">${escapeHTML(group.name)}</span>`;
  const nameEl = chip.querySelector('.group-name');

  chip.addEventListener('click', () => {
    if (nameEl.isContentEditable) return;
    group.collapsed = !group.collapsed;
    renderTabStrip();
  });

  chip.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    nameEl.contentEditable = 'true';
    nameEl.focus();
    document.execCommand('selectAll', false, null);
  });

  nameEl.addEventListener('blur', () => {
    nameEl.contentEditable = 'false';
    group.name = nameEl.textContent.trim() || group.name;
    nameEl.textContent = group.name;
  });

  nameEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nameEl.blur();
    }
  });

  return chip;
}

function syncAddressBar(tab) {
  addressBar.value = tab.url === HOME_URL ? '' : tab.url;
}

function updateNavButtons() {
  const tab = tabs.get(activeTabId);
  if (!tab) return;
  backBtn.disabled = !tab.webview.canGoBack();
  forwardBtn.disabled = !tab.webview.canGoForward();
}

function activeWebview() {
  const tab = tabs.get(activeTabId);
  return tab ? tab.webview : null;
}

newTabBtn.addEventListener('click', () => createTab(HOME_URL));

backBtn.addEventListener('click', () => activeWebview()?.goBack());
forwardBtn.addEventListener('click', () => activeWebview()?.goForward());
reloadBtn.addEventListener('click', () => {
  const wv = activeWebview();
  if (!wv) return;
  wv.isLoading() ? wv.stop() : wv.reload();
});

// ---------- address bar suggestions ----------

const suggestDropdown = document.getElementById('suggest-dropdown');
/** @type {{group:'local'|'search', text:string, url:?string, favicon:?string}[]} */
let suggestItems = [];
let highlightedIndex = -1;
let suggestDebounce = null;

function hostnameOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function closeSuggestions() {
  suggestDropdown.classList.remove('visible');
  suggestDropdown.innerHTML = '';
  suggestItems = [];
  highlightedIndex = -1;
}

function suggestItemHTML(item, index) {
  const icon = item.favicon
    ? `<img class="suggest-icon" src="${escapeHTML(item.favicon)}" onerror="this.style.visibility='hidden'" />`
    : '<span class="suggest-icon"></span>';
  const urlPart = item.url ? `<span class="suggest-url">${escapeHTML(hostnameOf(item.url))}</span>` : '';
  return `<div class="suggest-item${index === highlightedIndex ? ' highlighted' : ''}" data-index="${index}">
    ${icon}<span class="suggest-title">${escapeHTML(item.text)}</span>${urlPart}
  </div>`;
}

function renderSuggestions() {
  if (suggestItems.length === 0) {
    closeSuggestions();
    return;
  }

  const local = suggestItems.map((item, i) => ({ ...item, i })).filter((item) => item.group === 'local');
  const search = suggestItems.map((item, i) => ({ ...item, i })).filter((item) => item.group === 'search');

  let html = '';
  if (local.length) {
    html += '<div class="suggest-group-label">History &amp; Bookmarks</div>';
    html += local.map((item) => suggestItemHTML(item, item.i)).join('');
  }
  if (search.length) {
    html += '<div class="suggest-group-label">Search Suggestions</div>';
    html += search.map((item) => suggestItemHTML(item, item.i)).join('');
  }
  suggestDropdown.innerHTML = html;
  suggestDropdown.classList.add('visible');

  suggestDropdown.querySelectorAll('.suggest-item').forEach((el) => {
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectSuggestion(Number(el.dataset.index));
    });
  });
}

function selectSuggestion(index) {
  const item = suggestItems[index];
  const wv = activeWebview();
  if (!item || !wv) return;
  closeSuggestions();
  const target = item.url || item.text;
  addressBar.value = target;
  wv.loadURL(normalizeInput(target));
}

async function updateSuggestions(query) {
  const local = await window.browserAPI.getLocalSuggestions(query);
  if (addressBar.value.trim() !== query.trim()) return;
  suggestItems = local.map((m) => ({ group: 'local', text: m.title, url: m.url, favicon: m.favicon }));
  highlightedIndex = -1;
  renderSuggestions();

  if (IS_PRIVATE) return;

  const remote = await window.browserAPI.getSearchSuggestions(query);
  if (addressBar.value.trim() !== query.trim()) return;
  const remoteItems = remote
    .filter((text) => text.toLowerCase() !== query.toLowerCase())
    .map((text) => ({ group: 'search', text, url: null, favicon: null }));
  suggestItems = suggestItems.concat(remoteItems);
  renderSuggestions();
}

addressBar.addEventListener('input', () => {
  const query = addressBar.value;
  clearTimeout(suggestDebounce);
  if (!query.trim()) {
    closeSuggestions();
    return;
  }
  suggestDebounce = setTimeout(() => updateSuggestions(query), 150);
});

addressBar.addEventListener('blur', () => {
  // Delay so a mousedown on a suggestion can register before the dropdown unmounts.
  setTimeout(closeSuggestions, 100);
});

addressBar.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    if (suggestItems.length === 0) return;
    e.preventDefault();
    highlightedIndex = Math.min(suggestItems.length - 1, highlightedIndex + 1);
    renderSuggestions();
  } else if (e.key === 'ArrowUp') {
    if (suggestItems.length === 0) return;
    e.preventDefault();
    highlightedIndex = Math.max(0, highlightedIndex - 1);
    renderSuggestions();
  } else if (e.key === 'Escape') {
    closeSuggestions();
  } else if (e.key === 'Enter') {
    const wv = activeWebview();
    if (!wv) return;
    if (highlightedIndex >= 0 && suggestItems[highlightedIndex]) {
      selectSuggestion(highlightedIndex);
    } else {
      closeSuggestions();
      wv.loadURL(normalizeInput(addressBar.value));
      wv.focus();
    }
  }
});

// ---------- tab group context menu ----------

let ctxTabId = null;

tabStrip.addEventListener('contextmenu', (e) => {
  const tabEl = e.target.closest('.tab');
  if (!tabEl) return;
  e.preventDefault();
  ctxTabId = Number(tabEl.dataset.tabId);
  openCtxMenu(e.clientX, e.clientY);
});

function openCtxMenu(x, y) {
  const tab = tabs.get(ctxTabId);
  ctxMenu.querySelector('[data-action="remove-group"]').style.display = tab?.groupId ? 'block' : 'none';
  ctxGroupList.innerHTML = [...groups.values()]
    .filter((g) => g.id !== tab?.groupId)
    .map((g) => `<button data-action="add-group" data-group-id="${g.id}">Add to “${escapeHTML(g.name)}”</button>`)
    .join('');
  ctxMenu.style.left = `${x}px`;
  ctxMenu.style.top = `${y}px`;
  ctxMenu.classList.add('visible');
}

function closeCtxMenu() {
  ctxMenu.classList.remove('visible');
  ctxTabId = null;
}

ctxMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn || ctxTabId === null) return;
  const tab = tabs.get(ctxTabId);
  if (!tab) return;

  if (btn.dataset.action === 'new-group') {
    const id = nextGroupId++;
    const color = GROUP_COLORS[groups.size % GROUP_COLORS.length];
    groups.set(id, { id, name: `Group ${id}`, color, collapsed: false });
    tab.groupId = id;
    renderTabStrip();
  } else if (btn.dataset.action === 'add-group') {
    tab.groupId = Number(btn.dataset.groupId);
    renderTabStrip();
  } else if (btn.dataset.action === 'remove-group') {
    const oldGroupId = tab.groupId;
    tab.groupId = null;
    if (oldGroupId && ![...tabs.values()].some((t) => t.groupId === oldGroupId)) groups.delete(oldGroupId);
    renderTabStrip();
  } else if (btn.dataset.action === 'close') {
    closeTab(ctxTabId);
  }
  closeCtxMenu();
});

window.addEventListener('click', (e) => {
  if (!ctxMenu.contains(e.target)) closeCtxMenu();
});

// ---------- bookmarks ----------

async function refreshBookmarkState() {
  const tab = tabs.get(activeTabId);
  if (!tab || IS_PRIVATE) {
    bookmarkBtn.classList.remove('active');
    return;
  }
  const isBookmarked = await window.browserAPI.isBookmarked(tab.url);
  bookmarkBtn.classList.toggle('active', isBookmarked);
}

async function toggleBookmark() {
  const tab = tabs.get(activeTabId);
  if (!tab || IS_PRIVATE) return;
  await window.browserAPI.toggleBookmark({ url: tab.url, title: tab.title, favicon: tab.favicon });
  refreshBookmarkState();
}

bookmarkBtn.addEventListener('click', toggleBookmark);

// ---------- reader mode ----------

let readerModeScriptPromise = null;
function getReaderModeScript() {
  if (!readerModeScriptPromise) {
    readerModeScriptPromise = fetch(new URL('reader-mode-inject.js', document.baseURI)).then((r) => r.text());
  }
  return readerModeScriptPromise;
}

async function toggleReaderMode() {
  const wv = activeWebview();
  if (!wv) return;
  const script = await getReaderModeScript();
  const result = await wv.executeJavaScript(script);
  readerBtn.classList.toggle('active', result === 'opened');
}

readerBtn.addEventListener('click', toggleReaderMode);

// ---------- picture-in-picture ----------

function enterPictureInPicture() {
  activeWebview()?.executeJavaScript(
    `(function(){var v=document.querySelector('video');if(v&&document.pictureInPictureEnabled)v.requestPictureInPicture().catch(function(){});})()`
  );
}

// ---------- internal pages ----------

historyBtn.addEventListener('click', () => createTab(internalUrl('history')));
bookmarksBtn.addEventListener('click', () => createTab(internalUrl('bookmarks')));
downloadsBtn.addEventListener('click', () => createTab(internalUrl('downloads')));
privacyBtn.addEventListener('click', () => createTab(internalUrl('privacy')));
settingsBtn.addEventListener('click', () => createTab(internalUrl('settings')));

// ---------- find in page ----------

function openFindBar() {
  findBar.classList.add('visible');
  findInput.value = '';
  findCount.textContent = '';
  findInput.focus();
}

function closeFindBar() {
  if (!findBar || !findBar.classList.contains('visible')) return;
  findBar.classList.remove('visible');
  activeWebview()?.stopFindInPage('clearSelection');
}

function runFind(forward = true, findNext = false) {
  const wv = activeWebview();
  if (!wv || !findInput.value) return;
  wv.findInPage(findInput.value, { forward, findNext });
}

findInput.addEventListener('input', () => runFind(true, false));
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    runFind(!e.shiftKey, true);
  } else if (e.key === 'Escape') {
    closeFindBar();
  }
});
findPrevBtn.addEventListener('click', () => runFind(false, true));
findNextBtn.addEventListener('click', () => runFind(true, true));
findCloseBtn.addEventListener('click', closeFindBar);

// ---------- zoom ----------

function zoomBy(delta) {
  const wv = activeWebview();
  if (!wv) return;
  const next = Math.min(3, Math.max(0.25, wv.getZoomFactor() + delta));
  wv.setZoomFactor(next);
}

function zoomReset() {
  activeWebview()?.setZoomFactor(1);
}

// ---------- native menu actions ----------

window.browserAPI.onMenuAction((action) => {
  switch (action) {
    case 'new-tab':
      createTab(HOME_URL);
      break;
    case 'close-tab':
      if (activeTabId !== null) closeTab(activeTabId);
      break;
    case 'reload':
      activeWebview()?.reload();
      break;
    case 'go-back':
      activeWebview()?.goBack();
      break;
    case 'go-forward':
      activeWebview()?.goForward();
      break;
    case 'force-reload':
      activeWebview()?.reloadIgnoringCache();
      break;
    case 'find':
      openFindBar();
      break;
    case 'print':
      activeWebview()?.print();
      break;
    case 'zoom-in':
      zoomBy(0.1);
      break;
    case 'zoom-out':
      zoomBy(-0.1);
      break;
    case 'zoom-reset':
      zoomReset();
      break;
    case 'toggle-bookmark':
      toggleBookmark();
      break;
    case 'reader-mode':
      toggleReaderMode();
      break;
    case 'pip':
      enterPictureInPicture();
      break;
    case 'history':
      createTab(internalUrl('history'));
      break;
    case 'bookmarks':
      createTab(internalUrl('bookmarks'));
      break;
    case 'downloads':
      createTab(internalUrl('downloads'));
      break;
    case 'privacy':
      createTab(internalUrl('privacy'));
      break;
    case 'settings':
    case 'delete-browsing-data':
      createTab(internalUrl('settings'));
      break;
    default:
      break;
  }
});

window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  if (e.key.toLowerCase() === 't') {
    e.preventDefault();
    createTab(HOME_URL);
  } else if (e.key.toLowerCase() === 'w') {
    e.preventDefault();
    if (activeTabId !== null) closeTab(activeTabId);
  } else if (e.key.toLowerCase() === 'l') {
    e.preventDefault();
    addressBar.select();
    addressBar.focus();
  }
});

const adblockToggle = document.getElementById('adblock-toggle');
const adblockLabel = document.getElementById('adblock-label');
const shieldPop = document.getElementById('shield-pop');
const shieldSwitchBtn = document.getElementById('shield-switch-btn');
const shieldSw = document.getElementById('shield-sw');
const popBlockedEl = document.getElementById('pop-blocked');
const popNetworksEl = document.getElementById('pop-networks');

let adBlockEnabled = true;
let lastBlockedCount = 0;
let lastNetworkCount = 0;

function renderAdBlockState() {
  adblockToggle.classList.toggle('off', !adBlockEnabled);
  adblockLabel.textContent = adBlockEnabled ? (lastBlockedCount > 0 ? `${lastBlockedCount} blocked` : 'On') : 'Off';
  shieldSw.classList.toggle('off', !adBlockEnabled);
  popBlockedEl.textContent = lastBlockedCount;
  popNetworksEl.textContent = lastNetworkCount;
}

window.browserAPI.getAdBlockEnabled().then((enabled) => {
  adBlockEnabled = enabled;
  renderAdBlockState();
});

// Clicking the shield opens a small status popover (mirroring the
// gushu-toolbar.html spec); the actual on/off toggle lives on the switch
// inside it, not on the shield button itself.
adblockToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  const willOpen = shieldPop.hidden;
  shieldPop.hidden = !willOpen;
  adblockToggle.setAttribute('aria-expanded', String(willOpen));
});

shieldSwitchBtn.addEventListener('click', async () => {
  adBlockEnabled = await window.browserAPI.setAdBlockEnabled(!adBlockEnabled);
  renderAdBlockState();
});

window.addEventListener('click', (e) => {
  if (!shieldPop.hidden && !e.target.closest('.omni-wrap')) {
    shieldPop.hidden = true;
    adblockToggle.setAttribute('aria-expanded', 'false');
  }
});

// Lets you see, live, whether blocking is actually happening on the page
// you're looking at — useful for confirming the blocklist is catching
// that site's ad network.
setInterval(async () => {
  lastBlockedCount = await window.browserAPI.getBlockedCount();
  const report = await window.browserAPI.getPrivacyReport();
  lastNetworkCount = report.byDomain.length;
  renderAdBlockState();
}, 1500);

createTab(HOME_URL);
