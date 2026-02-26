const { contextBridge, ipcRenderer } = require('electron');

// Internal pages bridge (used by file://.../internal/*.html rendered inside the webview)
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
  try {
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
      notifySettingChanged: (key, value) => ipcRenderer.send('setting-changed', key, value),
      openUrlInBrowser: (url) => ipcRenderer.send('open-url-in-browser', url),

      // Profiles
      profilesList: () => ipcRenderer.invoke('profiles-list'),
      profilesCurrent: () => ipcRenderer.invoke('profiles-current'),
      profilesCreate: (name) => ipcRenderer.invoke('profiles-create', name),
      profilesSwitch: (profileId) => ipcRenderer.invoke('profiles-switch', profileId),

      // Extensions
      extensionsList: () => ipcRenderer.invoke('extensions-list'),
      extensionsMetadata: () => ipcRenderer.invoke('extensions-metadata'),
      extensionsInstallUnpacked: () => ipcRenderer.invoke('extensions-install-unpacked'),
      extensionsInstallCrx: () => ipcRenderer.invoke('extensions-install-crx'),
      extensionsInstallWebStoreUrl: (urlOrId) => ipcRenderer.invoke('extensions-install-webstore-url', urlOrId),
      extensionsRemove: (extensionId) => ipcRenderer.invoke('extensions-remove', extensionId),
      extensionsPinnedGet: () => ipcRenderer.invoke('extensions-pinned-get'),
      extensionsPinnedSet: (ids) => ipcRenderer.invoke('extensions-pinned-set', ids),
      extensionsOpenPopup: (payload) => ipcRenderer.invoke('extensions-open-popup', payload),
    });
  } catch {
    // ignore
  }
}

function isValidUrl(u) {
  try {
    const s = String(u || '').trim();
    if (!s) return false;
    if (s.startsWith('javascript:')) return false;
    return true;
  } catch {
    return false;
  }
}

function extractHrefFromHtml(html) {
  try {
    const raw = String(html || '');
    const m = raw.match(/href\s*=\s*"([^"]+)"/i) || raw.match(/href\s*=\s*'([^']+)'/i);
    return m && m[1] ? String(m[1]).trim() : '';
  } catch {
    return '';
  }
}

window.addEventListener(
  'dragstart',
  (e) => {
    try {
      const t = e && e.target ? e.target.closest('a[href]') : null;
      const href = t && t.getAttribute ? String(t.getAttribute('href') || '') : '';
      const abs = href ? new URL(href, location.href).toString() : '';
      if (isValidUrl(abs)) {
        ipcRenderer.sendToHost('blynx-link-drag-start', { url: abs });
      }
    } catch {
      // ignore
    }
  },
  true
);

window.addEventListener(
  'dragend',
  () => {
    try {
      ipcRenderer.sendToHost('blynx-link-drag-end', {});
    } catch {
      // ignore
    }
  },
  true
);

// Fallback: when a link is dragged, some sites don't expose href on the element;
// try to use DataTransfer formats.
window.addEventListener(
  'dragstart',
  (e) => {
    try {
      const dt = e && e.dataTransfer ? e.dataTransfer : null;
      if (!dt) return;

      const uriList = dt.getData('text/uri-list');
      if (uriList) {
        const first = uriList.split(/\r?\n/).find((l) => l && !l.startsWith('#'));
        if (isValidUrl(first)) {
          ipcRenderer.sendToHost('blynx-link-drag-start', { url: String(first).trim() });
          return;
        }
      }

      const url = dt.getData('URL');
      if (isValidUrl(url)) {
        ipcRenderer.sendToHost('blynx-link-drag-start', { url: String(url).trim() });
        return;
      }

      const moz = dt.getData('text/x-moz-url');
      if (moz && moz.trim()) {
        const first = moz.split(/\r?\n/)[0];
        if (isValidUrl(first)) {
          ipcRenderer.sendToHost('blynx-link-drag-start', { url: String(first).trim() });
          return;
        }
      }

      const html = dt.getData('text/html');
      const href = extractHrefFromHtml(html);
      if (href) {
        const abs = new URL(href, location.href).toString();
        if (isValidUrl(abs)) {
          ipcRenderer.sendToHost('blynx-link-drag-start', { url: abs });
        }
      }
    } catch {
      // ignore
    }
  },
  true
);
