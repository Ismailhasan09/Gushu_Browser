const { contextBridge, ipcRenderer } = require('electron');

// Attached to every <webview> tab — both real websites and our own
// internal pages (history/bookmarks/downloads/settings/privacy/start).
// It only ever exposes anything when the loaded page is one of our own
// trusted file:// pages; a real website gets nothing from this bridge,
// since the check runs here in the preload's privileged context, not in
// page script that a malicious site could fake.
function isInternalPage() {
  if (location.protocol !== 'file:') return false;
  return location.pathname.includes('/renderer/internal/') || location.pathname.endsWith('/renderer/start.html');
}

const PROFILE_ID = new URLSearchParams(location.search).get('profile') || 'default';

function guarded(invoke) {
  return (...args) => (isInternalPage() ? invoke(...args) : Promise.reject(new Error('not allowed')));
}

contextBridge.exposeInMainWorld('internalAPI', {
  getHistory: guarded(() => ipcRenderer.invoke('history:list', PROFILE_ID)),
  clearHistory: guarded(() => ipcRenderer.invoke('history:clear', PROFILE_ID)),
  getTopSites: guarded((limit) => ipcRenderer.invoke('history:top-sites', PROFILE_ID, limit)),

  getBookmarks: guarded(() => ipcRenderer.invoke('bookmarks:list', PROFILE_ID)),
  removeBookmark: guarded((url) => ipcRenderer.invoke('bookmarks:remove', PROFILE_ID, url)),

  getDownloads: guarded(() => ipcRenderer.invoke('downloads:list', PROFILE_ID)),
  clearDownloads: guarded(() => ipcRenderer.invoke('downloads:clear', PROFILE_ID)),
  openDownloadFolder: guarded((id) => ipcRenderer.invoke('downloads:open-folder', PROFILE_ID, id)),

  getAdBlockEnabled: guarded(() => ipcRenderer.invoke('ad-block:get', PROFILE_ID)),
  setAdBlockEnabled: guarded((value) => ipcRenderer.invoke('ad-block:set', PROFILE_ID, value)),
  getBlockedCount: guarded(() => ipcRenderer.invoke('ad-block:count', PROFILE_ID)),

  deleteBrowsingData: guarded(() => ipcRenderer.invoke('browsing-data:delete', PROFILE_ID)),

  getPrivacyReport: guarded(() => ipcRenderer.invoke('privacy:report', PROFILE_ID)),

  getProfiles: guarded(() => ipcRenderer.invoke('profiles:list')),
  createProfile: guarded((entry) => ipcRenderer.invoke('profiles:create', entry)),
  openProfileWindow: guarded((id) => ipcRenderer.invoke('profiles:open', id)),
});

// Two-finger trackpad swipe-to-navigate (what Safari/Chrome do on macOS).
// Electron has no built-in hook for this — only a 3-finger "swipe" event,
// which is a different gesture. This just watches real wheel events for a
// strongly horizontal gesture and tells the main process to navigate the
// webview that received it; it never touches page content or exposes
// anything into the page's own JS, so it's safe to run on every site.
(function setupSwipeNavigation() {
  const THRESHOLD = 150;
  let accumX = 0;
  let locked = false;
  let resetTimer = null;

  function reset() {
    accumX = 0;
    locked = false;
  }

  window.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) return; // pinch-to-zoom also fires wheel events with ctrlKey

      clearTimeout(resetTimer);
      resetTimer = setTimeout(reset, 200);

      accumX += e.deltaX;
      if (locked || Math.abs(accumX) < THRESHOLD || Math.abs(e.deltaX) < Math.abs(e.deltaY) * 1.5) return;

      locked = true;
      // Natural scrolling (the default) makes a rightward finger swipe
      // report a negative deltaX, matching Safari's "swipe right = back".
      ipcRenderer.send('gesture-navigate', accumX < 0 ? 'back' : 'forward');
    },
    { passive: true }
  );
})();
