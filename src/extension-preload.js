const { ipcRenderer } = require('electron');

function isChromeExtensionPage() {
  try {
    return typeof location !== 'undefined' && String(location.protocol) === 'chrome-extension:';
  } catch {
    return false;
  }
}

function getExtensionIdFromLocation() {
  try {
    const u = new URL(String(location.href));
    return u.hostname || '';
  } catch {
    return '';
  }
}

function createChromeStorageArea(areaName, extensionId) {
  const listeners = new Set();

  function emit(changes, area) {
    try {
      listeners.forEach((fn) => {
        try {
          fn(changes, area);
        } catch {
          // ignore
        }
      });
    } catch {
      // ignore
    }
  }

  ipcRenderer.on('ext-storage-changed', (_e, payload) => {
    try {
      if (!payload || payload.extensionId !== extensionId) return;
      if (payload.areaName !== areaName) return;
      emit(payload.changes || {}, areaName);
    } catch {
      // ignore
    }
  });

  return {
    get: (keys, callback) => {
      const p = ipcRenderer.invoke('ext-storage-get', { extensionId, areaName, keys });
      if (typeof callback === 'function') {
        p.then((res) => callback(res)).catch(() => callback({}));
        return;
      }
      return p;
    },
    set: (items, callback) => {
      const p = ipcRenderer.invoke('ext-storage-set', { extensionId, areaName, items });
      if (typeof callback === 'function') {
        p.then(() => callback()).catch(() => callback());
        return;
      }
      return p;
    },
    remove: (keys, callback) => {
      const p = ipcRenderer.invoke('ext-storage-remove', { extensionId, areaName, keys });
      if (typeof callback === 'function') {
        p.then(() => callback()).catch(() => callback());
        return;
      }
      return p;
    },
    clear: (callback) => {
      const p = ipcRenderer.invoke('ext-storage-clear', { extensionId, areaName });
      if (typeof callback === 'function') {
        p.then(() => callback()).catch(() => callback());
        return;
      }
      return p;
    },
    onChanged: {
      addListener: (fn) => {
        if (typeof fn === 'function') listeners.add(fn);
      },
      removeListener: (fn) => {
        listeners.delete(fn);
      }
    }
  };
}

(function init() {
  if (!isChromeExtensionPage()) return;

  const extensionId = getExtensionIdFromLocation();
  if (!extensionId) return;

  // Provide a minimal subset of the Chrome Extensions API used by many popups/background scripts.
  // This is intentionally small and focuses on storage.* which is missing in Electron.
  const root = (typeof globalThis !== 'undefined' ? globalThis : window);
  const chromeObj = root.chrome && typeof root.chrome === 'object' ? root.chrome : {};

  const storage = chromeObj.storage && typeof chromeObj.storage === 'object' ? chromeObj.storage : {};
  storage.local = storage.local || createChromeStorageArea('local', extensionId);
  storage.sync = storage.sync || createChromeStorageArea('sync', extensionId);

  chromeObj.storage = storage;

  if (!chromeObj.runtime) chromeObj.runtime = {};
  if (!chromeObj.runtime.lastError) chromeObj.runtime.lastError = null;

  root.chrome = chromeObj;
})();
