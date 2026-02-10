const { app, BrowserWindow, ipcMain, shell, session, Menu, protocol, webContents, Tray, clipboard, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const fs = require('fs');
const Store = require('electron-store');
const https = require('https');
const extractZip = require('extract-zip');

let tray = null;
let tabDragBuffer = null;
let tabDragClaimed = false;

function broadcastToAllWindows(channel, payload) {
  try {
    BrowserWindow.getAllWindows().forEach((w) => {
      try {
        if (w && !w.isDestroyed()) {
          w.webContents.send(channel, payload);
        }
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

const childWindowParentContents = new WeakMap();

function getExtensionStorageStore(profileId, extensionId) {
  const id = profileId || 'default';
  const extId = extensionId || 'unknown';
  const dataDir = path.join(app.getPath('userData'), id, 'ext-storage', extId);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return new Store({ name: 'storage', cwd: dataDir });
}

function normalizeStorageKeysArg(keys) {
  if (keys == null) return { mode: 'all' };
  if (typeof keys === 'string') return { mode: 'list', keys: [keys] };
  if (Array.isArray(keys)) return { mode: 'list', keys: keys.map(String) };
  if (typeof keys === 'object') return { mode: 'defaults', defaults: keys };
  return { mode: 'all' };
}

function buildStorageChanges(prevObj, nextObj) {
  const changes = {};
  const keys = new Set([
    ...Object.keys(prevObj || {}),
    ...Object.keys(nextObj || {})
  ]);
  keys.forEach((k) => {
    const oldValue = prevObj ? prevObj[k] : undefined;
    const newValue = nextObj ? nextObj[k] : undefined;
    const same = JSON.stringify(oldValue) === JSON.stringify(newValue);
    if (!same) {
      changes[k] = { oldValue, newValue };
    }
  });
  return changes;
}

// Performance switches (desktop-focused)
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// fix tray icon made from chat gpt 
app.whenReady().then(() => {
  // Create tray icon
  tray = new Tray(path.join(__dirname, 'assets', 'favicon.ico'));
  tray.setToolTip('Blynx'); // optional tooltip

  // Optionally, you can add a context menu
  const { Menu } = require('electron');
  const trayMenu = Menu.buildFromTemplate([
    { label: 'Open Blynx', click: () => {
        const allWindows = BrowserWindow.getAllWindows();
        if (allWindows.length) {
          allWindows[0].show();
          allWindows[0].focus();
        }
      } 
    },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' }
  ]);
  tray.setContextMenu(trayMenu);
});
// end
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

function getOwnerWindowForContents(contents) {
  try {
    const host = contents && contents.hostWebContents ? contents.hostWebContents : null;
    if (host) return BrowserWindow.fromWebContents(host);
    return BrowserWindow.fromWebContents(contents);
  } catch {
    return null;
  }
}

function sendToOwnerNewTab(contents, url) {
  try {
    const win = getOwnerWindowForContents(contents);
    if (win && !win.isDestroyed()) {
      win.webContents.send('new-tab', url);
    }
  } catch {
    // ignore
  }
}

function buildContextMenu(contents, params) {
  const template = [];

  const win = getOwnerWindowForContents(contents);
  const canGoBack = typeof contents.canGoBack === 'function' ? contents.canGoBack() : false;
  const canGoForward = typeof contents.canGoForward === 'function' ? contents.canGoForward() : false;

  const pageURL = params && params.pageURL ? String(params.pageURL) : '';
  const linkURL = params && params.linkURL ? String(params.linkURL) : '';
  const srcURL = params && params.srcURL ? String(params.srcURL) : '';
  const selectionText = params && params.selectionText ? String(params.selectionText).trim() : '';
  const isEditable = !!(params && params.isEditable);
  const editFlags = (params && params.editFlags) || {};
  const mediaType = params && params.mediaType ? String(params.mediaType) : '';

  if (linkURL) {
    template.push(
      {
        label: 'Open link in new tab',
        click: () => sendToOwnerNewTab(contents, linkURL)
      },
      {
        label: 'Open link in new tab (background)',
        click: () => {
          try {
            const w = getOwnerWindowForContents(contents);
            if (w && !w.isDestroyed()) {
              w.webContents.send('new-tab-background', linkURL);
              return;
            }
          } catch {
            // ignore
          }
          sendToOwnerNewTab(contents, linkURL);
        }
      },
      {
        label: 'Open link in new window',
        click: () => createMainWindow({ isSecondary: true, initialUrl: linkURL })
      },
      { type: 'separator' },
      {
        label: 'Copy link address',
        role: 'copyLink'
      },
      {
        label: 'Save link as...',
        click: () => {
          try { contents.downloadURL(linkURL); } catch (_) { /* ignore */ }
        }
      }
    );
    template.push({ type: 'separator' });
  }

  if (mediaType === 'image' && srcURL) {
    template.push(
      {
        label: 'Open image in new tab',
        click: () => sendToOwnerNewTab(contents, srcURL)
      },
      {
        label: 'Copy image',
        role: 'copyImage'
      },
      {
        label: 'Copy image address',
        role: 'copyImageAddress'
      },
      {
        label: 'Save image as...',
        click: () => {
          try { contents.downloadURL(srcURL); } catch (_) { /* ignore */ }
        }
      }
    );
    template.push({ type: 'separator' });
  }

  if ((mediaType === 'video' || mediaType === 'audio') && srcURL) {
    template.push(
      {
        label: mediaType === 'video' ? 'Open video in new tab' : 'Open audio in new tab',
        click: () => sendToOwnerNewTab(contents, srcURL)
      },
      {
        label: 'Save as...',
        click: () => {
          try { contents.downloadURL(srcURL); } catch (_) { /* ignore */ }
        }
      }
    );
    template.push({ type: 'separator' });
  }

  if (selectionText) {
    const q = encodeURIComponent(selectionText);
    template.push(
      {
        label: `Search Google for "${selectionText.length > 32 ? selectionText.slice(0, 32) + '…' : selectionText}"`,
        click: () => sendToOwnerNewTab(contents, `https://www.google.com/search?q=${q}`)
      },
      { type: 'separator' }
    );
  }

  if (isEditable) {
    template.push(
      { label: 'Undo', enabled: !!editFlags.canUndo, role: 'undo' },
      { label: 'Redo', enabled: !!editFlags.canRedo, role: 'redo' },
      { type: 'separator' },
      { label: 'Cut', enabled: !!editFlags.canCut, role: 'cut' },
      { label: 'Copy', enabled: !!editFlags.canCopy, role: 'copy' },
      { label: 'Paste', enabled: !!editFlags.canPaste, role: 'paste' },
      { label: 'Paste and match style', enabled: !!editFlags.canPaste, role: 'pasteAndMatchStyle' },
      { type: 'separator' },
      { label: 'Select all', role: 'selectAll' },
      { type: 'separator' }
    );
  } else {
    template.push(
      { label: 'Back', enabled: canGoBack, click: () => { try { contents.goBack(); } catch (_) { /* ignore */ } } },
      { label: 'Forward', enabled: canGoForward, click: () => { try { contents.goForward(); } catch (_) { /* ignore */ } } },
      { label: 'Reload', click: () => { try { contents.reload(); } catch (_) { /* ignore */ } } },
      { type: 'separator' },
      { label: 'Copy', enabled: !!editFlags.canCopy || !!selectionText, role: 'copy' },
      { label: 'Select all', role: 'selectAll' },
      { type: 'separator' }
    );
  }

  if (pageURL) {
    template.push(
      {
        label: 'View page source',
        click: () => sendToOwnerNewTab(contents, `view-source:${pageURL}`)
      }
    );
  }

  template.push(
    { type: 'separator' },
    {
      label: 'Inspect',
      click: () => {
        try {
          contents.openDevTools({ mode: 'detach' });
          contents.inspectElement(params.x, params.y);
        } catch (_) {
          // ignore
        }
      }
    }
  );

  const menu = Menu.buildFromTemplate(template);
  return { menu, win };
}

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

function readJsonFileSafe(p) {
  try {
    if (!p || !fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pickBestIconPath(manifest) {
  try {
    const icons = manifest && manifest.icons ? manifest.icons : null;
    if (!icons || typeof icons !== 'object') return null;
    const sizes = Object.keys(icons)
      .map(k => Number(k))
      .filter(n => Number.isFinite(n))
      .sort((a, b) => a - b);
    if (sizes.length === 0) return null;
    const preferred = sizes.find(s => s >= 32) || sizes[sizes.length - 1];
    return icons[String(preferred)] || null;
  } catch {
    return null;
  }
}

function getPopupPathFromManifest(manifest) {
  try {
    if (!manifest || typeof manifest !== 'object') return null;
    const action = manifest.action || manifest.browser_action || null;
    const popup = action && action.default_popup ? String(action.default_popup) : '';
    return popup ? popup : null;
  } catch {
    return null;
  }
}

function getExtensionsMetadataForProfile(profileId) {
  const ses = getProfileSession(profileId);
  const exts = ses.getAllExtensions ? ses.getAllExtensions() : new Map();
  const out = [];

  try {
    for (const ext of exts.values()) {
      if (!ext || !ext.id) continue;

      const manifest = ext.manifest || readJsonFileSafe(path.join(ext.path, 'manifest.json'));
      const iconRel = pickBestIconPath(manifest);
      const iconUrl = iconRel
        ? pathToFileURL(path.join(ext.path, iconRel)).toString()
        : null;

      const popupPath = getPopupPathFromManifest(manifest);

      out.push({
        id: ext.id,
        name: ext.name,
        version: ext.version,
        path: ext.path,
        iconUrl,
        popupPath
      });
    }
  } catch {
    // ignore
  }

  return out;
}

let extensionPopupWindow = null;

function closeExtensionPopupWindow() {
  try {
    if (extensionPopupWindow && !extensionPopupWindow.isDestroyed()) {
      extensionPopupWindow.close();
    }
  } catch {
    // ignore
  }
  extensionPopupWindow = null;
}

function getProfilePartition(profileId) {
  const id = profileId || 'default';
  return `persist:blynx-${id}`;
}

function getProfileSession(profileId) {
  const partition = getProfilePartition(profileId);
  const ses = session.fromPartition(partition);
  registerBlynxProtocolForSession(ses);
  try {
    const existing = typeof ses.getPreloads === 'function' ? ses.getPreloads() : [];
    const preloadPath = path.join(__dirname, 'extension-preload.js');
    const next = Array.isArray(existing) ? existing.slice() : [];
    if (!next.includes(preloadPath)) {
      next.push(preloadPath);
      if (typeof ses.setPreloads === 'function') {
        ses.setPreloads(next);
      }
    }
  } catch {
    // ignore
  }
  return ses;
}

function ensureDir(p) {
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

function getProfileExtensionsDir(profileId) {
  const id = profileId || 'default';
  const dir = path.join(app.getPath('userData'), id, 'extensions');
  ensureDir(dir);
  return dir;
}

function findZipStartInCrxBuffer(buf) {
  if (!buf || buf.length < 4) return -1;
  // ZIP local file header signature
  const sig = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
  return buf.indexOf(sig);
}

function extractExtensionIdFromWebStoreUrl(input) {
  try {
    const raw = String(input || '').trim();
    if (!raw) return null;

    // Allow pasting just the ID
    if (/^[a-p]{32}$/.test(raw)) return raw;

    const u = new URL(raw);
    const id = u.searchParams.get('id');
    if (id && /^[a-p]{32}$/.test(id)) return id;

    // Typical pattern: /detail/<name>/<id>
    const parts = u.pathname.split('/').filter(Boolean);
    const maybe = parts[parts.length - 1];
    if (maybe && /^[a-p]{32}$/.test(maybe)) return maybe;
    return null;
  } catch {
    return null;
  }
}

function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    const u = String(url || '').trim();
    if (!u) {
      reject(new Error('Missing URL'));
      return;
    }

    const req = https.get(u, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers && res.headers.location ? String(res.headers.location) : '';
      if (status >= 300 && status < 400 && location) {
        res.resume();
        resolve(downloadToBuffer(location));
        return;
      }

      if (status < 200 || status >= 300) {
        res.resume();
        reject(new Error(`HTTP ${status}`));
        return;
      }

      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
  });
}

async function installExtensionFromCrxBuffer({ profileId, crxBuffer, suggestedId = null }) {
  const pid = profileId || 'default';
  const extDirRoot = getProfileExtensionsDir(pid);

  const zipStart = findZipStartInCrxBuffer(crxBuffer);
  if (zipStart < 0) {
    throw new Error('Could not parse CRX (ZIP payload not found)');
  }

  const zipBuf = crxBuffer.slice(zipStart);
  const now = Date.now();
  const baseName = suggestedId && /^[a-p]{32}$/.test(String(suggestedId))
    ? String(suggestedId)
    : 'extension';

  const installDir = path.join(extDirRoot, `${baseName}-${now}`);
  ensureDir(installDir);

  const zipPath = path.join(installDir, 'ext.zip');
  fs.writeFileSync(zipPath, zipBuf);

  await extractZip(zipPath, { dir: installDir });
  try {
    fs.unlinkSync(zipPath);
  } catch {
    // ignore
  }

  const ses = getProfileSession(pid);
  const ext = await ses.loadExtension(installDir, { allowFileAccess: true });

  const s = getProfileStore(pid);
  const existing = s.get('extensions.paths', []);
  const next = Array.isArray(existing) ? existing.slice() : [];
  if (!next.includes(installDir)) {
    next.push(installDir);
    s.set('extensions.paths', next);
  }

  return {
    id: ext.id,
    name: ext.name,
    version: ext.version,
    path: ext.path
  };
}

async function loadPersistedExtensionsForProfile(profileId) {
  const s = getProfileStore(profileId || 'default');
  const paths = s.get('extensions.paths', []);
  const ses = getProfileSession(profileId);

  const safePaths = Array.isArray(paths)
    ? paths
        .map(p => (typeof p === 'string' ? p.trim() : ''))
        .filter(Boolean)
    : [];

  const loaded = ses.getAllExtensions ? ses.getAllExtensions() : new Map();
  const loadedPaths = new Set();
  try {
    for (const ext of loaded.values()) {
      if (ext && ext.path) loadedPaths.add(ext.path);
    }
  } catch {
    // ignore
  }

  for (const extPath of safePaths) {
    if (loadedPaths.has(extPath)) continue;
    try {
      await ses.loadExtension(extPath, { allowFileAccess: true });
    } catch (e) {
      // ignore
    }
  }
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
      backgroundThrottling: false,
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
    try {
      const u = String(url || '');

      // Allow DevTools to open normally (inspect uses this)
      if (u.startsWith('devtools://') || u.startsWith('chrome-devtools://')) {
        return { action: 'allow' };
      }

      // Some OAuth/login flows begin with about:blank and only later navigate to the real URL.
      // Allow the blank child window to be created so we can capture its first real navigation.
      if (u === 'about:blank') {
        return { action: 'allow' };
      }

      // Allow extension-owned windows (some extensions open their own pages)
      if (u.startsWith('chrome-extension://')) {
        return { action: 'allow' };
      }

      // Route all other window.open/popups into a new tab in the *owning* window
      if (u) {
        sendToOwnerNewTab(contents, u);
      }
    } catch {
      // ignore
    }

    return { action: 'deny' };
  });

  contents.on('did-create-window', (childWindow) => {
    try {
      if (!childWindow || childWindow.isDestroyed()) return;

      // Remember the opener so the child can open the new tab in the correct window.
      childWindowParentContents.set(childWindow.webContents, contents);

      let handled = false;
      const maybeHandleUrl = (rawUrl) => {
        if (handled) return;
        const u = rawUrl ? String(rawUrl) : '';
        if (!u || u === 'about:blank') return;
        if (u.startsWith('devtools://') || u.startsWith('chrome-devtools://')) return;

        handled = true;
        sendToOwnerNewTab(contents, u);
        try {
          if (!childWindow.isDestroyed()) childWindow.close();
        } catch {
          // ignore
        }
      };

      childWindow.webContents.on('will-navigate', (ev, u) => {
        try { ev.preventDefault(); } catch {}
        maybeHandleUrl(u);
      });
      childWindow.webContents.on('did-navigate', (_ev, u) => {
        maybeHandleUrl(u);
      });
      childWindow.webContents.on('did-navigate-in-page', (_ev, u) => {
        maybeHandleUrl(u);
      });
    } catch {
      // ignore
    }
  });

  contents.on('context-menu', (_event, params) => {
    try {
      const { menu, win } = buildContextMenu(contents, params);
      if (menu) {
        menu.popup({ window: win || undefined });
      }
    } catch (err) {
      // ignore
    }
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

ipcMain.handle('ext-storage-get', (_e, { extensionId, areaName, keys }) => {
  const profileId = getCurrentProfileId();
  const id = extensionId ? String(extensionId) : '';
  const area = areaName ? String(areaName) : 'local';
  if (!id) return {};

  const st = getExtensionStorageStore(profileId, id);
  const norm = normalizeStorageKeysArg(keys);

  if (norm.mode === 'all') {
    try {
      return st.store || {};
    } catch {
      return {};
    }
  }

  if (norm.mode === 'list') {
    const out = {};
    (norm.keys || []).forEach((k) => {
      try {
        out[k] = st.get(`${area}.${k}`);
      } catch {
        out[k] = undefined;
      }
    });
    return out;
  }

  if (norm.mode === 'defaults') {
    const out = {};
    const defs = norm.defaults || {};
    Object.keys(defs).forEach((k) => {
      try {
        const v = st.get(`${area}.${k}`);
        out[k] = v === undefined ? defs[k] : v;
      } catch {
        out[k] = defs[k];
      }
    });
    return out;
  }

  return {};
});

ipcMain.handle('ext-storage-set', (_e, { extensionId, areaName, items }) => {
  const profileId = getCurrentProfileId();
  const id = extensionId ? String(extensionId) : '';
  const area = areaName ? String(areaName) : 'local';
  if (!id) return true;

  const st = getExtensionStorageStore(profileId, id);
  const safe = items && typeof items === 'object' ? items : {};
  const prev = {};
  const next = {};
  Object.keys(safe).forEach((k) => {
    try {
      prev[k] = st.get(`${area}.${k}`);
    } catch {
      prev[k] = undefined;
    }
    next[k] = safe[k];
    try {
      st.set(`${area}.${k}`, safe[k]);
    } catch {
      // ignore
    }
  });

  const changes = buildStorageChanges(prev, next);
  if (changes && Object.keys(changes).length > 0) {
    broadcastToAllWindows('ext-storage-changed', { extensionId: id, areaName: area, changes });
  }
  return true;
});

ipcMain.handle('ext-storage-remove', (_e, { extensionId, areaName, keys }) => {
  const profileId = getCurrentProfileId();
  const id = extensionId ? String(extensionId) : '';
  const area = areaName ? String(areaName) : 'local';
  if (!id) return true;

  const st = getExtensionStorageStore(profileId, id);
  const norm = normalizeStorageKeysArg(keys);
  const list = norm.mode === 'list' ? (norm.keys || []) : [];
  const prev = {};
  const next = {};
  list.forEach((k) => {
    try {
      prev[k] = st.get(`${area}.${k}`);
    } catch {
      prev[k] = undefined;
    }
    next[k] = undefined;
    try {
      st.delete(`${area}.${k}`);
    } catch {
      // ignore
    }
  });

  const changes = buildStorageChanges(prev, next);
  if (changes && Object.keys(changes).length > 0) {
    broadcastToAllWindows('ext-storage-changed', { extensionId: id, areaName: area, changes });
  }
  return true;
});

ipcMain.handle('ext-storage-clear', (_e, { extensionId, areaName }) => {
  const profileId = getCurrentProfileId();
  const id = extensionId ? String(extensionId) : '';
  const area = areaName ? String(areaName) : 'local';
  if (!id) return true;

  const st = getExtensionStorageStore(profileId, id);
  let prev = {};
  try {
    prev = st.get(area, {});
  } catch {
    prev = {};
  }
  try {
    st.delete(area);
  } catch {
    // ignore
  }

  const next = {};
  const changes = buildStorageChanges(prev, next);
  if (changes && Object.keys(changes).length > 0) {
    broadcastToAllWindows('ext-storage-changed', { extensionId: id, areaName: area, changes });
  }
  return true;
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

ipcMain.handle('update-bookmark', (e, bookmark) => {
  const profileId = getCurrentProfileId();
  const s = getProfileStore(profileId);
  const bookmarks = s.get(profileKey('bookmarks'), []);

  const id = bookmark && bookmark.id;
  if (!id) return bookmarks;

  const idx = bookmarks.findIndex(b => b.id === id);
  if (idx === -1) return bookmarks;

  const next = {
    ...bookmarks[idx],
    ...bookmark,
    updatedAt: new Date().toISOString()
  };
  bookmarks[idx] = next;
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

  getProfileSession(profileId);
  loadPersistedExtensionsForProfile(profileId).catch(() => {});

  if (mainWindow) {
    mainWindow.webContents.send('profile-changed', profileId);
  }

  return true;
});

ipcMain.handle('ensure-profile-session', (e, profileId) => {
  const partition = getProfilePartition(profileId);
  getProfileSession(profileId);
  loadPersistedExtensionsForProfile(profileId).catch(() => {});
  return partition;
});

ipcMain.handle('extensions-list', () => {
  const profileId = getCurrentProfileId();
  const ses = getProfileSession(profileId);
  const exts = ses.getAllExtensions ? ses.getAllExtensions() : new Map();
  const out = [];
  try {
    for (const ext of exts.values()) {
      if (!ext) continue;
      out.push({
        id: ext.id,
        name: ext.name,
        version: ext.version,
        path: ext.path
      });
    }
  } catch {
    // ignore
  }
  return out;
});

ipcMain.handle('extensions-metadata', () => {
  const profileId = getCurrentProfileId();
  return getExtensionsMetadataForProfile(profileId);
});

ipcMain.handle('extensions-pinned-get', () => {
  const profileId = getCurrentProfileId();
  const s = getProfileStore(profileId);
  const ids = s.get('extensions.pinned', []);
  return Array.isArray(ids) ? ids.filter(v => typeof v === 'string' && v.length > 0) : [];
});

ipcMain.handle('extensions-pinned-set', (_e, ids) => {
  const profileId = getCurrentProfileId();
  const s = getProfileStore(profileId);
  const safe = Array.isArray(ids)
    ? ids.map(v => (typeof v === 'string' ? v.trim() : '')).filter(Boolean)
    : [];
  s.set('extensions.pinned', safe);
  broadcastToAllWindows('extensions-pinned-changed', { profileId, ids: safe });
  return safe;
});

ipcMain.handle('extensions-open-popup', async (_e, { extensionId, anchorRect }) => {
  const profileId = getCurrentProfileId();
  const id = extensionId ? String(extensionId) : '';
  if (!id) return { ok: false };

  const meta = getExtensionsMetadataForProfile(profileId).find(e => e.id === id);
  if (!meta || !meta.popupPath) return { ok: false, error: 'Extension has no popup' };

  const hostWin = BrowserWindow.getFocusedWindow();
  if (!hostWin) return { ok: false };

  closeExtensionPopupWindow();

  const popupUrl = `chrome-extension://${id}/${meta.popupPath.replace(/^\/+/, '')}`;

  const winBounds = hostWin.getBounds();
  const ar = anchorRect && typeof anchorRect === 'object' ? anchorRect : null;
  const ax = ar && Number.isFinite(ar.x) ? ar.x : 0;
  const ay = ar && Number.isFinite(ar.y) ? ar.y : 0;
  const aw = ar && Number.isFinite(ar.width) ? ar.width : 0;

  const width = 360;
  const height = 520;
  const x = Math.max(winBounds.x + 8, Math.min(winBounds.x + winBounds.width - width - 8, winBounds.x + ax + aw - width));
  const y = Math.max(winBounds.y + 8, winBounds.y + ay + 42);

  extensionPopupWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    frame: false,
    resizable: false,
    movable: false,
    show: false,
    parent: hostWin,
    modal: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: getProfilePartition(profileId),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  extensionPopupWindow.webContents.on('before-input-event', (_ev, input) => {
    try {
      if (input && input.type === 'keyDown' && input.key === 'Escape') {
        closeExtensionPopupWindow();
      }
    } catch {
      // ignore
    }
  });

  extensionPopupWindow.on('blur', () => {
    // Delay slightly so clicks inside the popup don't immediately close it due to focus churn.
    setTimeout(() => {
      try {
        if (!extensionPopupWindow || extensionPopupWindow.isDestroyed()) return;
        if (extensionPopupWindow.isFocused()) return;
        closeExtensionPopupWindow();
      } catch {
        // ignore
      }
    }, 150);
  });

  const didFailLoad = new Promise((resolve) => {
    try {
      extensionPopupWindow.webContents.once('did-fail-load', (_e2, errorCode, errorDescription, validatedURL) => {
        resolve({ errorCode, errorDescription, validatedURL });
      });
    } catch {
      resolve(null);
    }
  });

  try {
    await extensionPopupWindow.loadURL(popupUrl);
  } catch (err) {
    try {
      if (extensionPopupWindow && !extensionPopupWindow.isDestroyed()) {
        extensionPopupWindow.close();
      }
    } catch {
      // ignore
    }
    extensionPopupWindow = null;
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }

  try {
    const fail = await Promise.race([
      didFailLoad,
      new Promise((resolve) => setTimeout(() => resolve(null), 0))
    ]);
    if (fail && fail.errorCode) {
      closeExtensionPopupWindow();
      return { ok: false, error: `${fail.errorDescription || 'did-fail-load'} (${fail.errorCode})`, url: fail.validatedURL };
    }
  } catch {
    // ignore
  }

  try {
    if (extensionPopupWindow && !extensionPopupWindow.isDestroyed()) {
      extensionPopupWindow.show();
    }
  } catch {
    // ignore
  }

  return { ok: true };
});

ipcMain.handle('extensions-install-unpacked', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Load unpacked extension',
    properties: ['openDirectory']
  });
  if (result.canceled) return { ok: false, canceled: true };
  const dir = result.filePaths && result.filePaths[0] ? String(result.filePaths[0]) : '';
  if (!dir) return { ok: false, canceled: true };

  const profileId = getCurrentProfileId();
  const ses = getProfileSession(profileId);

  const ext = await ses.loadExtension(dir, { allowFileAccess: true });

  const s = getProfileStore(profileId);
  const existing = s.get('extensions.paths', []);
  const next = Array.isArray(existing) ? existing.slice() : [];
  if (!next.includes(dir)) {
    next.push(dir);
    s.set('extensions.paths', next);
  }

  broadcastToAllWindows('extensions-changed', { profileId });

  return {
    ok: true,
    extension: {
      id: ext.id,
      name: ext.name,
      version: ext.version,
      path: ext.path
    }
  };
});

ipcMain.handle('extensions-install-crx', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Install extension from CRX',
    properties: ['openFile'],
    filters: [
      { name: 'Chrome Extension', extensions: ['crx'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled) return { ok: false, canceled: true };
  const filePath = result.filePaths && result.filePaths[0] ? String(result.filePaths[0]) : '';
  if (!filePath) return { ok: false, canceled: true };

  const profileId = getCurrentProfileId();
  const buf = fs.readFileSync(filePath);
  const ext = await installExtensionFromCrxBuffer({ profileId, crxBuffer: buf });

  broadcastToAllWindows('extensions-changed', { profileId });
  return { ok: true, extension: ext };
});

ipcMain.handle('extensions-install-webstore-url', async (_e, urlOrId) => {
  const profileId = getCurrentProfileId();
  const id = extractExtensionIdFromWebStoreUrl(urlOrId);
  if (!id) {
    return { ok: false, error: 'Could not extract extension id from URL' };
  }

  const crxUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=120.0.0.0&acceptformat=crx2,crx3&x=id%3D${id}%26installsource%3Dondemand%26uc`;
  const buf = await downloadToBuffer(crxUrl);
  const ext = await installExtensionFromCrxBuffer({ profileId, crxBuffer: buf, suggestedId: id });
  broadcastToAllWindows('extensions-changed', { profileId });
  return { ok: true, extension: ext };
});

ipcMain.handle('extensions-remove', async (_e, extensionId) => {
  const id = extensionId ? String(extensionId) : '';
  if (!id) return { ok: false };

  const profileId = getCurrentProfileId();
  const ses = getProfileSession(profileId);

  let ext = null;
  try {
    ext = ses.getExtension ? ses.getExtension(id) : null;
  } catch {
    ext = null;
  }

  try {
    if (ses.removeExtension) {
      ses.removeExtension(id);
    }
  } catch {
    // ignore
  }

  const s = getProfileStore(profileId);
  const existing = s.get('extensions.paths', []);
  if (ext && ext.path && Array.isArray(existing)) {
    const next = existing.filter(p => p !== ext.path);
    s.set('extensions.paths', next);
  }

  // Remove from pinned list if present
  try {
    const pinned = s.get('extensions.pinned', []);
    if (Array.isArray(pinned) && pinned.includes(id)) {
      s.set('extensions.pinned', pinned.filter(x => x !== id));
    }
  } catch {
    // ignore
  }

  broadcastToAllWindows('extensions-changed', { profileId });

  return { ok: true };
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
