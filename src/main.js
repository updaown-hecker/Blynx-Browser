const { app, BrowserWindow, ipcMain, shell, session, Menu, protocol, webContents } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const Store = require('electron-store');

let tabDragBuffer = null;
let tabDragClaimed = false;

const projectUserDataDir = path.join(__dirname, 'userdata');
if (!fs.existsSync(projectUserDataDir)) {
  fs.mkdirSync(projectUserDataDir, { recursive: true });
}
app.setPath('userData', projectUserDataDir);

ipcMain.on('tab-drag-start', (_e, payload) => {
  tabDragBuffer = payload || null;
  tabDragClaimed = false;
});

ipcMain.handle('tab-drag-claim', () => {
  if (!tabDragBuffer) return null;
  tabDragClaimed = true;
  return tabDragBuffer;
});

ipcMain.handle('tab-drag-was-claimed', () => {
  return tabDragClaimed;
});

ipcMain.handle('create-window-with-tab', (_e, payload) => {
  const url = payload && payload.url ? String(payload.url) : null;
  if (!url) return false;
  createMainWindow({ isSecondary: true, initialUrl: url });
  return true;
});

let globalStore;
function getGlobalStore() {
  if (globalStore) return globalStore;
  const dataDir = path.join(app.getPath('userData'), 'global');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  globalStore = new Store({
    name: 'blynx',
    cwd: dataDir
  });
  return globalStore;
}

const profileStores = new Map();
function getProfileStore(profileId) {
  const id = profileId || 'default';
  if (profileStores.has(id)) return profileStores.get(id);
  const dataDir = path.join(app.getPath('userData'), id);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const s = new Store({
    name: 'blynx',
    cwd: dataDir
  });
  profileStores.set(id, s);
  return s;
}

function getCurrentProfileId() {
  return getGlobalStore().get('profiles.currentId', 'default');
}

function profileKey(key) {
  return key;
}

function ensureProfilesSchema() {
  const s = getGlobalStore();

  // Migrate older schema if present
  const legacyProfilesArray = s.get('profiles', null);
  if (Array.isArray(legacyProfilesArray)) {
    if (!s.has('profiles.list')) {
      s.set('profiles.list', legacyProfilesArray);
    }
    s.delete('profiles');
  }
  if (s.has('currentProfileId') && !s.has('profiles.currentId')) {
    s.set('profiles.currentId', s.get('currentProfileId'));
    s.delete('currentProfileId');
  }

  // Ensure at least default profile exists
  const list = s.get('profiles.list', null);
  if (!Array.isArray(list) || list.length === 0) {
    s.set('profiles.list', [{ id: 'default', name: 'Default', createdAt: new Date().toISOString() }]);
  }
  if (!s.has('profiles.currentId')) {
    s.set('profiles.currentId', 'default');
  }

  // Migrate legacy bookmarks/history into per-profile store (default)
  const defaultProfileStore = getProfileStore('default');

  const legacyBookmarks = s.get('bookmarks', null);
  if (Array.isArray(legacyBookmarks)) {
    const existing = defaultProfileStore.get('bookmarks', []);
    if (!Array.isArray(existing) || existing.length === 0) {
      defaultProfileStore.set('bookmarks', legacyBookmarks);
    }
    s.delete('bookmarks');
  }
  const legacyHistory = s.get('history', null);
  if (Array.isArray(legacyHistory)) {
    const existing = defaultProfileStore.get('history', []);
    if (!Array.isArray(existing) || existing.length === 0) {
      defaultProfileStore.set('history', legacyHistory);
    }
    s.delete('history');
  }

  const legacyProfileBookmarks = s.get('profiles.default.bookmarks', null);
  if (Array.isArray(legacyProfileBookmarks)) {
    const existing = defaultProfileStore.get('bookmarks', []);
    if (!Array.isArray(existing) || existing.length === 0) {
      defaultProfileStore.set('bookmarks', legacyProfileBookmarks);
    }
    s.delete('profiles.default.bookmarks');
  }
  const legacyProfileHistory = s.get('profiles.default.history', null);
  if (Array.isArray(legacyProfileHistory)) {
    const existing = defaultProfileStore.get('history', []);
    if (!Array.isArray(existing) || existing.length === 0) {
      defaultProfileStore.set('history', legacyProfileHistory);
    }
    s.delete('profiles.default.history');
  }

  // Migrate newer profile-scoped keys (from previous schema) into per-profile stores
  const profiles = s.get('profiles.list', []);
  if (Array.isArray(profiles)) {
    profiles.forEach((p) => {
      if (!p || !p.id) return;
      const ps = getProfileStore(p.id);

      const bkKey = `profiles.data.${p.id}.bookmarks`;
      const hiKey = `profiles.data.${p.id}.history`;
      const tabsKey = `profiles.data.${p.id}.session.tabs`;

      const bookmarks = s.get(bkKey, null);
      if (Array.isArray(bookmarks)) {
        const existing = ps.get('bookmarks', []);
        if (!Array.isArray(existing) || existing.length === 0) {
          ps.set('bookmarks', bookmarks);
        }
        s.delete(bkKey);
      }

      const history = s.get(hiKey, null);
      if (Array.isArray(history)) {
        const existing = ps.get('history', []);
        if (!Array.isArray(existing) || existing.length === 0) {
          ps.set('history', history);
        }
        s.delete(hiKey);
      }

      const tabs = s.get(tabsKey, null);
      if (Array.isArray(tabs)) {
        const existing = ps.get('session.tabs', []);
        if (!Array.isArray(existing) || existing.length === 0) {
          ps.set('session.tabs', tabs);
        }
        s.delete(tabsKey);
      }
    });
  }
}

const registeredProtocolPartitions = new Set();

function registerBlynxProtocolForSession(ses) {
  if (!ses || !ses.protocol) return;
  const partitionName = ses.getPartition ? ses.getPartition() : 'default';
  if (registeredProtocolPartitions.has(partitionName)) return;
  registeredProtocolPartitions.add(partitionName);

  ses.protocol.registerFileProtocol('blynx', (request, callback) => {
    const url = new URL(request.url);
    const hostname = url.hostname;

    const pageMap = {
      'settings': 'settings.html',
      'history': 'history.html',
      'bookmarks': 'bookmarks.html',
      'downloads': 'downloads.html',
      'extensions': 'extensions.html',
      'about': 'about.html',
      'newtab': 'newtab.html'
    };

    const page = pageMap[hostname] || 'newtab.html';
    const filePath = path.join(__dirname, 'internal', page);

    if (!fs.existsSync(filePath)) {
      callback({ path: path.join(__dirname, 'internal', 'newtab.html') });
      return;
    }

    callback({ path: filePath });
  });
}
let mainWindow;
let windows = [];

const isDev = process.argv.includes('--dev');

if (process.platform === 'win32') {
  app.setAppUserModelId('com.blynx.browser');
}

// Register custom protocol
electronProtocol()

function electronProtocol() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'blynx',
      privileges: {
        secure: true,
        standard: true,
        supportFetchAPI: true,
        bypassCSP: false,
        allowServiceWorkers: true,
        corsEnabled: true
      }
    }
  ]);
}

// Create main browser window
function createMainWindow(opts = {}) {
  const { isSecondary = false, initialUrl = null } = opts;
  const windowState = getGlobalStore().get('windowState', {
    width: 1280,
    height: 800,
    x: undefined,
    y: undefined
  });

  const win = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: windowState.x,
    y: windowState.y,
    minWidth: 800,
    minHeight: 600,
    title: 'Blynx',
    icon: path.join(__dirname, 'assets', 'App-icon.ico'),
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: true,
      webviewTag: true
    }
  });

  // Load the browser UI
  win.loadFile(path.join(__dirname, 'renderer', 'browser.html'));

  // Ensure Ctrl/Cmd+W closes the current tab (even when a webview has focus)
  const closeTabShortcutHandler = (event, input) => {
    try {
      if ((input.control || input.meta) && String(input.key).toLowerCase() === 'w') {
        event.preventDefault();
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('close-current-tab');
        }
      }
    } catch (_) {
      // ignore
    }
  };

  win.webContents.on('before-input-event', closeTabShortcutHandler);
  win.webContents.on('did-attach-webview', (_event, webContents) => {
    webContents.on('before-input-event', closeTabShortcutHandler);
  });

  // Save window state on close
  win.on('close', () => {
    const bounds = win.getBounds();
    getGlobalStore().set('windowState', bounds);
  });

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
    windows = windows.filter(w => w !== win);
  });

  windows.push(win);

  if (!mainWindow && !isSecondary) {
    mainWindow = win;
  }

  if (initialUrl) {
    win.webContents.once('did-finish-load', () => {
      try {
        win.webContents.send('new-tab', initialUrl);
      } catch (_) {
        // ignore
      }
    });
  }

  // Open DevTools in development
  if (isDev) {
    // DevTools should be opened explicitly by the user (F12 / Ctrl+Shift+I)
  }

  return win;
}

// Handle custom protocol
function handleBlynxProtocol() {
  // Register for default session
  const defaultSession = session.defaultSession;
  registerBlynxProtocolForSession(defaultSession);
  
  // Also register for webview partition session
  const webSession = session.fromPartition('persist:web');
  registerBlynxProtocolForSession(webSession);
}

// App event handlers
app.whenReady().then(() => {
  ensureProfilesSchema();
  handleBlynxProtocol();
  createMainWindow();
  setupMenu();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('web-contents-created', (e, contents) => {
  // Handle new windows
  contents.setWindowOpenHandler(({ url }) => {
    if (mainWindow) {
      mainWindow.webContents.send('new-tab', url);
    }
    return { action: 'deny' };
  });

  // Handle external links
  contents.on('will-navigate', (e, url) => {
    if (!url.startsWith('blynx://') && !url.startsWith('file://')) {
      // Allow navigation
    }
  });
});

// IPC handlers
ipcMain.handle('window-minimize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.minimize();
});

ipcMain.handle('window-maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  }
});

ipcMain.handle('window-close', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.close();
});

ipcMain.handle('is-window-maximized', () => {
  const win = BrowserWindow.getFocusedWindow();
  return win ? win.isMaximized() : false;
});

// Navigation handlers
ipcMain.handle('navigate-back', (e, webContentsId) => {
  const wc = webContents.fromId(webContentsId);
  if (wc && wc.canGoBack()) wc.goBack();
});

ipcMain.handle('navigate-forward', (e, webContentsId) => {
  const wc = webContents.fromId(webContentsId);
  if (wc && wc.canGoForward()) wc.goForward();
});

ipcMain.handle('navigate-reload', (e, webContentsId) => {
  const wc = webContents.fromId(webContentsId);
  if (wc) wc.reload();
});

ipcMain.handle('navigate-stop', (e, webContentsId) => {
  const wc = webContents.fromId(webContentsId);
  if (wc) wc.stop();
});

// Store handlers for settings/data
ipcMain.handle('store-get', (e, key, defaultValue) => {
  return getGlobalStore().get(key, defaultValue);
});

ipcMain.handle('store-set', (e, key, value) => {
  getGlobalStore().set(key, value);
});

ipcMain.handle('store-delete', (e, key) => {
  getGlobalStore().delete(key);
});

// Profile store handlers (per-profile persistent data in userdata/<profileId>/blynx.json)
ipcMain.handle('profile-store-get', (e, key, defaultValue) => {
  const profileId = getCurrentProfileId();
  return getProfileStore(profileId).get(key, defaultValue);
});

ipcMain.handle('profile-store-set', (e, key, value) => {
  const profileId = getCurrentProfileId();
  getProfileStore(profileId).set(key, value);
});

ipcMain.handle('profile-store-delete', (e, key) => {
  const profileId = getCurrentProfileId();
  getProfileStore(profileId).delete(key);
});

// Bookmarks
ipcMain.handle('get-bookmarks', () => {
  const profileId = getCurrentProfileId();
  return getProfileStore(profileId).get(profileKey('bookmarks'), []);
});

ipcMain.handle('add-bookmark', (e, bookmark) => {
  const profileId = getCurrentProfileId();
  const s = getProfileStore(profileId);
  const bookmarks = s.get(profileKey('bookmarks'), []);
  const existingIndex = bookmarks.findIndex(b => b.url === bookmark.url);
  if (existingIndex === -1) {
    bookmarks.push({ ...bookmark, id: Date.now(), createdAt: new Date().toISOString() });
    s.set(profileKey('bookmarks'), bookmarks);
  }
  return bookmarks;
});

ipcMain.handle('remove-bookmark', (e, id) => {
  const profileId = getCurrentProfileId();
  const s = getProfileStore(profileId);
  let bookmarks = s.get(profileKey('bookmarks'), []);
  bookmarks = bookmarks.filter(b => b.id !== id);
  s.set(profileKey('bookmarks'), bookmarks);
  return bookmarks;
});

// History
ipcMain.handle('get-history', () => {
  const profileId = getCurrentProfileId();
  return getProfileStore(profileId).get(profileKey('history'), []);
});

ipcMain.handle('set-history', (e, history) => {
  const profileId = getCurrentProfileId();
  const safeHistory = Array.isArray(history) ? history : [];
  getProfileStore(profileId).set(profileKey('history'), safeHistory);
  return safeHistory;
});

ipcMain.handle('add-history', (e, item) => {
  const profileId = getCurrentProfileId();
  const s = getProfileStore(profileId);
  const history = s.get(profileKey('history'), []);
  // Remove duplicate if exists
  const filtered = history.filter(h => h.url !== item.url);
  // Add to beginning
  filtered.unshift({ ...item, id: Date.now(), visitedAt: new Date().toISOString() });
  // Keep only last 1000 entries
  if (filtered.length > 1000) filtered.pop();
  s.set(profileKey('history'), filtered);
  return filtered;
});

ipcMain.handle('clear-history', () => {
  const profileId = getCurrentProfileId();
  getProfileStore(profileId).set(profileKey('history'), []);
  return [];
});

// Profiles
ipcMain.handle('profiles-list', () => {
  ensureProfilesSchema();
  return getGlobalStore().get('profiles.list', []);
});

ipcMain.handle('profiles-current', () => {
  ensureProfilesSchema();
  return getCurrentProfileId();
});

ipcMain.handle('profiles-create', (e, name) => {
  ensureProfilesSchema();
  const profiles = getGlobalStore().get('profiles.list', []);
  let n = profiles.length + 1;
  let id = `user${n}`;
  while (profiles.some(p => p.id === id)) {
    n += 1;
    id = `user${n}`;
  }
  const profile = { id, name: name || `Profile ${profiles.length + 1}`, createdAt: new Date().toISOString() };
  profiles.push(profile);
  getGlobalStore().set('profiles.list', profiles);
  return profile;
});

ipcMain.handle('profiles-switch', (e, profileId) => {
  ensureProfilesSchema();
  const profiles = getGlobalStore().get('profiles.list', []);
  const exists = profiles.some(p => p.id === profileId);
  if (!exists) return false;
  getGlobalStore().set('profiles.currentId', profileId);

  const partition = `persist:blynx-${profileId}`;
  const ses = session.fromPartition(partition);
  registerBlynxProtocolForSession(ses);

  if (mainWindow) {
    mainWindow.webContents.send('profile-changed', profileId);
  }

  return true;
});

ipcMain.handle('ensure-profile-session', (e, profileId) => {
  const partition = `persist:blynx-${profileId}`;
  const ses = session.fromPartition(partition);
  registerBlynxProtocolForSession(ses);
  return partition;
});

// Search engine handler
const searchEngines = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  yahoo: 'https://search.yahoo.com/search?p=',
  brave: 'https://search.brave.com/search?q='
};

ipcMain.handle('get-search-engine', () => {
  return getGlobalStore().get('searchEngine', 'google');
});

ipcMain.handle('get-search-url', (e, query) => {
  const engine = getGlobalStore().get('searchEngine', 'google');
  const searchUrl = searchEngines[engine] || searchEngines.google;
  return searchUrl + encodeURIComponent(query);
});

ipcMain.handle('get-internal-page-url', (e, page) => {
  const filePath = path.join(__dirname, 'internal', page);
  return pathToFileURL(filePath).toString();
});

ipcMain.handle('get-internal-preload-path', () => {
  return path.join(__dirname, 'internal-preload.js');
});

// Handle setting changes from internal pages
ipcMain.on('setting-changed', (e, key, value) => {
  // Broadcast to main browser window
  if (mainWindow) {
    mainWindow.webContents.send('setting-changed', key, value);
  }
});

ipcMain.on('open-url-in-browser', (e, url) => {
  if (mainWindow) {
    mainWindow.webContents.send('navigate-to', url);
  }
});

ipcMain.handle('clear-storage-data', async () => {
  const session = require('electron').session.defaultSession;
  await session.clearStorageData();
  return true;
});

// Setup application menu
function setupMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'New Tab',
          accelerator: 'CmdOrCtrl+T',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('new-tab', 'blynx://newtab');
          }
        },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => createMainWindow()
        },
        { type: 'separator' },
        {
          label: 'Open Location',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('focus-address-bar');
          }
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('close-current-tab');
          }
        },
        {
          label: 'Quit',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => app.quit()
        }
      ]
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
        { role: 'pasteandmatchstyle' },
        { role: 'delete' },
        { role: 'selectall' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'CmdOrCtrl+R',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('reload-current-tab');
          }
        },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('force-reload-current-tab');
          }
        },
        { role: 'toggledevtools' },
        { type: 'separator' },
        { role: 'resetzoom' },
        { role: 'zoomin' },
        { role: 'zoomout' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'History',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Alt+Left',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('navigate-back');
          }
        },
        {
          label: 'Forward',
          accelerator: 'Alt+Right',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('navigate-forward');
          }
        },
        { type: 'separator' },
        {
          label: 'Show Full History',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('new-tab', 'blynx://history');
          }
        },
        {
          label: 'Clear History',
          click: () => {
            const profileId = getCurrentProfileId();
            getProfileStore(profileId).set('history', []);
            if (mainWindow) mainWindow.webContents.send('history-cleared');
          }
        }
      ]
    },
    {
      label: 'Bookmarks',
      submenu: [
        {
          label: 'Bookmark This Tab',
          accelerator: 'CmdOrCtrl+D',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('bookmark-current-tab');
          }
        },
        {
          label: 'Show Bookmarks',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('new-tab', 'blynx://bookmarks');
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'close' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Blynx',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('new-tab', 'blynx://about');
          }
        },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => {
            if (mainWindow) mainWindow.webContents.send('new-tab', 'blynx://settings');
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Handle external links - open in default browser
app.on('open-url', (e, url) => {
  if (!url.startsWith('blynx://')) {
    shell.openExternal(url);
  }
});
