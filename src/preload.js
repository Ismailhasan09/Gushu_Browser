const { contextBridge, ipcRenderer } = require('electron');

const PROFILE_ID = new URLSearchParams(location.search).get('profile') || 'default';

contextBridge.exposeInMainWorld('browserAPI', {
  profileId: PROFILE_ID,

  getAdBlockEnabled: () => ipcRenderer.invoke('ad-block:get', PROFILE_ID),
  setAdBlockEnabled: (value) => ipcRenderer.invoke('ad-block:set', PROFILE_ID, value),
  getBlockedCount: () => ipcRenderer.invoke('ad-block:count', PROFILE_ID),
  getPrivacyReport: () => ipcRenderer.invoke('privacy:report', PROFILE_ID),

  addHistory: (entry) => ipcRenderer.invoke('history:add', PROFILE_ID, entry),

  toggleBookmark: (entry) => ipcRenderer.invoke('bookmarks:toggle', PROFILE_ID, entry),
  isBookmarked: (url) => ipcRenderer.invoke('bookmarks:is', PROFILE_ID, url),

  deleteBrowsingData: () => ipcRenderer.invoke('browsing-data:delete', PROFILE_ID),

  getProfiles: () => ipcRenderer.invoke('profiles:list'),

  getLocalSuggestions: (query) => ipcRenderer.invoke('suggest:local', PROFILE_ID, query),
  getSearchSuggestions: (query) => ipcRenderer.invoke('search:suggest', query),

  onMenuAction: (callback) => ipcRenderer.on('menu-action', (_event, action) => callback(action)),
});
