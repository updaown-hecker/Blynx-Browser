const { contextBridge, ipcRenderer } = require('electron');

// Expose the same APIs as main preload for internal pages
const href = (() => {
  try {
    return String(globalThis.location && globalThis.location.href ? globalThis.location.href : '');
  } catch {
    return '';
  }
})();

const isInternalPage =
  href.startsWith('file:') &&
  (href.includes('/internal/') || href.includes('\\internal\\') || href.toLowerCase().includes('internal'));

if (isInternalPage) {
  contextBridge.exposeInMainWorld('electronAPI', {
    storeGet: (key, defaultValue) => ipcRenderer.invoke('store-get', key, defaultValue),
    storeSet: (key, value) => ipcRenderer.invoke('store-set', key, value),
    profileStoreGet: (key, defaultValue) => ipcRenderer.invoke('profile-store-get', key, defaultValue),
    profileStoreSet: (key, value) => ipcRenderer.invoke('profile-store-set', key, value),
    profileStoreDelete: (key) => ipcRenderer.invoke('profile-store-delete', key),
    getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
    addBookmark: (bookmark) => ipcRenderer.invoke('add-bookmark', bookmark),
    removeBookmark: (id) => ipcRenderer.invoke('remove-bookmark', id),
    getHistory: () => ipcRenderer.invoke('get-history'),
    addHistory: (item) => ipcRenderer.invoke('add-history', item),
    setHistory: (history) => ipcRenderer.invoke('set-history', history),
    clearHistory: () => ipcRenderer.invoke('clear-history'),
    clearStorageData: () => ipcRenderer.invoke('clear-storage-data'),
    getSearchEngine: () => ipcRenderer.invoke('get-search-engine'),
    getSearchUrl: (query) => ipcRenderer.invoke('get-search-url', query),
    getInternalPageUrl: (page) => ipcRenderer.invoke('get-internal-page-url', page),
    // Notify main browser window of settings changes
    notifySettingChanged: (key, value) => ipcRenderer.send('setting-changed', key, value),
    // Request the main browser UI to navigate to a URL
    openUrlInBrowser: (url) => ipcRenderer.send('open-url-in-browser', url),

    // Profiles
    profilesList: () => ipcRenderer.invoke('profiles-list'),
    profilesCurrent: () => ipcRenderer.invoke('profiles-current'),
    profilesCreate: (name) => ipcRenderer.invoke('profiles-create', name),
    profilesSwitch: (profileId) => ipcRenderer.invoke('profiles-switch', profileId),
  });
}
