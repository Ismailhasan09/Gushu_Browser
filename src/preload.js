const { contextBridge, ipcRenderer } = require('electron');

const PROFILE_ID = new URLSearchParams(location.search).get('profile') || 'default';

contextBridge.exposeInMainWorld('browserAPI', {
  profileId: PROFILE_ID,
  platform: process.platform,

  getAdBlockEnabled: () => ipcRenderer.invoke('ad-block:get', PROFILE_ID),
  setAdBlockEnabled: (value) => ipcRenderer.invoke('ad-block:set', PROFILE_ID, value),
  getBlockedCount: () => ipcRenderer.invoke('ad-block:count', PROFILE_ID),
  isBlockedUrl: (url) => ipcRenderer.invoke('ad-block:is-blocked-url', PROFILE_ID, url),
  getPrivacyReport: () => ipcRenderer.invoke('privacy:report', PROFILE_ID),

  addHistory: (entry) => ipcRenderer.invoke('history:add', PROFILE_ID, entry),

  toggleBookmark: (entry) => ipcRenderer.invoke('bookmarks:toggle', PROFILE_ID, entry),
  isBookmarked: (url) => ipcRenderer.invoke('bookmarks:is', PROFILE_ID, url),

  deleteBrowsingData: () => ipcRenderer.invoke('browsing-data:delete', PROFILE_ID),

  notifyTabClosed: (entry) => ipcRenderer.invoke('tabs:notify-closed', PROFILE_ID, entry),

  getProfiles: () => ipcRenderer.invoke('profiles:list'),

  getLocalSuggestions: (query) => ipcRenderer.invoke('suggest:local', PROFILE_ID, query),
  getSearchSuggestions: (query) => ipcRenderer.invoke('search:suggest', query),

  getAskGushuKey: () => ipcRenderer.invoke('ask-gushu:get-key', PROFILE_ID),
  setAskGushuKey: (key) => ipcRenderer.invoke('ask-gushu:set-key', PROFILE_ID, key),
  sendAskGushu: (payload) => ipcRenderer.invoke('ask-gushu:send', PROFILE_ID, payload),

  getVpnState: () => ipcRenderer.invoke('vpn:get-state'),
  enableVpn: () => ipcRenderer.invoke('vpn:enable'),
  disableVpn: () => ipcRenderer.invoke('vpn:disable'),
  onVpnStateChanged: (callback) => ipcRenderer.on('vpn-state-changed', (_event, state) => callback(state)),

  onMenuAction: (callback) => ipcRenderer.on('menu-action', (_event, action) => callback(action)),
});
