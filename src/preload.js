const { contextBridge, ipcRenderer } = require('electron');

// Expose secure APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // Window controls
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  isWindowMaximized: () => ipcRenderer.invoke('is-window-maximized'),

  // Navigation
  navigateBack: (webContentsId) => ipcRenderer.invoke('navigate-back', webContentsId),
  navigateForward: (webContentsId) => ipcRenderer.invoke('navigate-forward', webContentsId),
  navigateReload: (webContentsId) => ipcRenderer.invoke('navigate-reload', webContentsId),
  navigateStop: (webContentsId) => ipcRenderer.invoke('navigate-stop', webContentsId),

  // Store/Settings
  storeGet: (key, defaultValue) => ipcRenderer.invoke('store-get', key, defaultValue),
  storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
  storeDelete: (key) => ipcRenderer.invoke('store-delete', key),

  // Profile-scoped storage
  profileStoreGet: (key, defaultValue) => ipcRenderer.invoke('profile-store-get', key, defaultValue),
  profileStoreSet: (key, value) => ipcRenderer.invoke('profile-store-set', key, value),
  profileStoreDelete: (key) => ipcRenderer.invoke('profile-store-delete', key),

  // Bookmarks
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark: (bookmark) => ipcRenderer.invoke('add-bookmark', bookmark),
  removeBookmark: (id) => ipcRenderer.invoke('remove-bookmark', id),

  // History
  getHistory: () => ipcRenderer.invoke('get-history'),
  addHistory: (item) => ipcRenderer.invoke('add-history', item),
  setHistory: (history) => ipcRenderer.invoke('set-history', history),
  clearHistory: () => ipcRenderer.invoke('clear-history'),

  // Storage
  clearStorageData: () => ipcRenderer.invoke('clear-storage-data'),

  // Search engine
  getSearchEngine: () => ipcRenderer.invoke('get-search-engine'),
  getSearchUrl: (query) => ipcRenderer.invoke('get-search-url', query),
  getInternalPageUrl: (page) => ipcRenderer.invoke('get-internal-page-url', page),
  getInternalPreloadPath: () => ipcRenderer.invoke('get-internal-preload-path'),

  // Profiles
  profilesList: () => ipcRenderer.invoke('profiles-list'),
  profilesCurrent: () => ipcRenderer.invoke('profiles-current'),
  profilesCreate: (name) => ipcRenderer.invoke('profiles-create', name),
  profilesSwitch: (profileId) => ipcRenderer.invoke('profiles-switch', profileId),
  ensureProfileSession: (profileId) => ipcRenderer.invoke('ensure-profile-session', profileId),

  // Event listeners
  onNewTab: (callback) => ipcRenderer.on('new-tab', (e, url) => callback(url)),
  onCloseCurrentTab: (callback) => ipcRenderer.on('close-current-tab', callback),
  onReloadCurrentTab: (callback) => ipcRenderer.on('reload-current-tab', callback),
  onForceReloadCurrentTab: (callback) => ipcRenderer.on('force-reload-current-tab', callback),
  onNavigateBack: (callback) => ipcRenderer.on('navigate-back', callback),
  onNavigateForward: (callback) => ipcRenderer.on('navigate-forward', callback),
  onFocusAddressBar: (callback) => ipcRenderer.on('focus-address-bar', callback),
  onBookmarkCurrentTab: (callback) => ipcRenderer.on('bookmark-current-tab', callback),
  onHistoryCleared: (callback) => ipcRenderer.on('history-cleared', callback),
  onSettingChanged: (callback) => ipcRenderer.on('setting-changed', (e, key, value) => callback(key, value)),
  onNavigateTo: (callback) => ipcRenderer.on('navigate-to', (e, url) => callback(url)),
  onMaximizeChange: (callback) => ipcRenderer.on('maximize-change', callback),
  onProfileChanged: (callback) => ipcRenderer.on('profile-changed', (e, profileId) => callback(profileId)),

  // Tab drag / tear-off
  tabDragStart: (payload) => ipcRenderer.send('tab-drag-start', payload),
  tabDragClaim: () => ipcRenderer.invoke('tab-drag-claim'),
  tabDragWasClaimed: () => ipcRenderer.invoke('tab-drag-was-claimed'),
  createWindowWithTab: (payload) => ipcRenderer.invoke('create-window-with-tab', payload),

  // Remove listeners
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel)
});
