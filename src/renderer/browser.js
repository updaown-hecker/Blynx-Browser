// Browser UI Controller
class BrowserController {
  constructor() {
    this.tabs = [];
    this.activeTabId = null;
    this.tabIdCounter = 0;
    this.windowMaximized = false;
    this.showBookmarksBar = true;
    this.currentProfileId = 'default';
    this.currentPartition = 'persist:blynx-default';

    // DOM Elements
    this.tabsContainer = document.getElementById('tabsContainer');
    this.webviewContainer = document.getElementById('webviewContainer');
    this.urlInput = document.getElementById('urlInput');
    this.backBtn = document.getElementById('backBtn');
    this.forwardBtn = document.getElementById('forwardBtn');
    this.reloadBtn = document.getElementById('reloadBtn');
    this.homeBtn = document.getElementById('homeBtn');
    this.bookmarkBtn = document.getElementById('bookmarkBtn');
    this.securityIcon = document.getElementById('securityIcon');
    this.browserMenu = document.getElementById('browserMenu');
    this.findBar = document.getElementById('findBar');
    this.bookmarksContainer = document.getElementById('bookmarksContainer');
    this.bookmarkBar = document.getElementById('bookmarkBar');
    this.bookmarkContextMenu = null;

    this.profileSelectMain = document.getElementById('profileSelectMain');
    this.profileAddBtn = document.getElementById('profileAddBtn');

    this.draggingTabId = null;
    this._tabDragOverId = null;
    this._tabDragDidDropInThisWindow = false;

    this.init();
  }

  sanitizeSessionUrl(url) {
    if (typeof url !== 'string') return null;
    const u = url.trim();
    if (!u) return null;
    if (u === 'about:blank') return null;
    if (u === 'about:srcdoc') return null;
    if (u.includes('*')) return null;
    return u;
  }

  async loadUrlInTab(tabId, url) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    const webview = this.webviewContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!webview) return;

    tab.displayUrl = url;

    if (url.startsWith('view-source:')) {
      const target = url.slice('view-source:'.length).trim();
      if (target.startsWith('blynx://')) {
        return;
      }
      tab.actualUrl = `view-source:${target}`;
      webview.setAttribute('src', `view-source:${target}`);
      return;
    }

    if (url.startsWith('blynx://')) {
      const hostname = url.replace('blynx://', '').split('/')[0];
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

      try {
        const fileUrl = await window.electronAPI.getInternalPageUrl(page);
        tab.actualUrl = fileUrl;
        if (this.internalPreloadPath) {
          webview.setAttribute('preload', this.internalPreloadPath);
        }
        webview.setAttribute('src', fileUrl);
      } catch (e) {
        console.error('Failed to get internal page URL:', e);
        webview.setAttribute('src', `data:text/html,<h1>Error loading page</h1><p>Could not load ${page}</p>`);
      }
    } else {
      tab.actualUrl = url;
      webview.setAttribute('src', url);
    }
  }

  async restoreSessionOrOpenNewTab() {
    const restore = await window.electronAPI.storeGet('restoreSession', false);
    if (restore) {
      const savedTabs = await window.electronAPI.profileStoreGet('session.tabs', []);
      if (Array.isArray(savedTabs) && savedTabs.length > 0) {
        const urls = savedTabs
          .map(u => this.sanitizeSessionUrl(u))
          .filter(Boolean);
        for (let i = 0; i < urls.length; i += 1) {
          const u = urls[i];
          const tab = this.createTab(u, i === 0);
          if (tab && tab.id && i !== 0) {
            try {
              await this.loadUrlInTab(tab.id, u);
            } catch (e) {
              console.error('Failed to restore tab:', e);
            }
          }
        }
        if (urls.length === 0) {
          this.createTab('blynx://newtab');
        }
        return;
      }
    }
    this.createTab('blynx://newtab');
  }

  async persistSessionTabs() {
    try {
      const urls = this.tabs
        .map(t => t.displayUrl || t.url)
        .filter(u => typeof u === 'string' && u.length > 0);
      await window.electronAPI.profileStoreSet('session.tabs', urls);
    } catch (e) {
      console.error('Failed to persist session tabs:', e);
    }
  }

  async init() {
    this.setupEventListeners();
    this.setupIpcListeners();

    try {
      this.internalPreloadPath = await window.electronAPI.getInternalPreloadPath();
    } catch (e) {
      console.error('Failed to load internal preload path:', e);
      this.internalPreloadPath = null;
    }

    // Profiles must be ready before we create any webviews so cookies + storage persist
    await this.loadProfile();
    try {
      await this.loadSettings();
    } catch (e) {
      console.error('Failed to load settings:', e);
    }

    // Startup tabs
    try {
      await this.restoreSessionOrOpenNewTab();
    } catch (e) {
      console.error('Failed during startup tab restore, opening new tab:', e);
      this.createTab('blynx://newtab');
    }

    // Check window state
    window.electronAPI.isWindowMaximized().then(maximized => {
      this.windowMaximized = maximized;
      this.updateMaximizeButton();
    });
  }

  toggleDevTools() {
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    if (!webview) return;
    try {
      if (webview.isDevToolsOpened && webview.isDevToolsOpened()) {
        webview.closeDevTools();
      } else {
        webview.openDevTools();
      }
    } catch (e) {
      console.error('Failed to toggle DevTools:', e);
    }
  }

  viewSourceCurrentTab() {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab) return;
    const u = tab.displayUrl || tab.url;
    if (!u) return;
    this.navigateTo(`view-source:${u}`);
  }

  setupEventListeners() {
    // Window controls
    document.getElementById('minimizeBtn').addEventListener('click', () => {
      window.electronAPI.windowMinimize();
    });

    document.getElementById('maximizeBtn').addEventListener('click', () => {
      window.electronAPI.windowMaximize();
    });

    document.getElementById('closeBtn').addEventListener('click', () => {
      window.electronAPI.windowClose();
    });

    // Tab controls
    document.getElementById('newTabBtn').addEventListener('click', () => {
      this.createTab('blynx://newtab');
    });

    // Navigation controls
    this.backBtn.addEventListener('click', () => this.goBack());
    this.forwardBtn.addEventListener('click', () => this.goForward());
    this.reloadBtn.addEventListener('click', () => this.reload());
    this.homeBtn.addEventListener('click', () => this.navigateTo(this.homePage || 'blynx://newtab'));

    if (this.profileSelectMain) {
      this.profileSelectMain.addEventListener('change', async () => {
        const profileId = this.profileSelectMain.value;
        if (!profileId) return;
        try {
          await window.electronAPI.profilesSwitch(profileId);
        } catch (e) {
          console.error('Failed to switch profile:', e);
        }
      });
    }

    if (this.profileAddBtn) {
      this.profileAddBtn.addEventListener('click', async () => {
        try {
          const created = await window.electronAPI.profilesCreate(null);
          if (created && created.id) {
            await window.electronAPI.profilesSwitch(created.id);
          }
        } catch (e) {
          console.error('Failed to create profile:', e);
        }
      });
    }

    // Address bar
    this.urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.handleAddressInput(this.urlInput.value);
      }
    });

    this.urlInput.addEventListener('focus', () => {
      this.urlInput.select();
    });

    // Bookmark button
    this.bookmarkBtn.addEventListener('click', () => this.toggleBookmark());

    // Menu button
    document.getElementById('menuBtn').addEventListener('click', () => {
      this.browserMenu.classList.toggle('show');
    });

    // Menu items
    document.getElementById('menuNewTab').addEventListener('click', () => {
      this.createTab('blynx://newtab');
      this.browserMenu.classList.remove('show');
    });

    // Bookmark bar toggle
    document.getElementById('bookmarkBarToggle').addEventListener('click', () => {
      this.toggleBookmarkBar();
    });

    document.getElementById('menuNewWindow').addEventListener('click', () => {
      window.electronAPI.storeSet('newWindow', true);
      this.browserMenu.classList.remove('show');
    });

    document.getElementById('menuBookmarks').addEventListener('click', () => {
      this.createTab('blynx://bookmarks');
      this.browserMenu.classList.remove('show');
    });

    document.getElementById('menuHistory').addEventListener('click', () => {
      this.createTab('blynx://history');
      this.browserMenu.classList.remove('show');
    });

    document.getElementById('menuDownloads').addEventListener('click', () => {
      this.createTab('blynx://downloads');
      this.browserMenu.classList.remove('show');
    });

    document.getElementById('menuSettings').addEventListener('click', () => {
      this.createTab('blynx://settings');
      this.browserMenu.classList.remove('show');
    });

    document.getElementById('menuHelp').addEventListener('click', () => {
      this.createTab('https://electronjs.org');
      this.browserMenu.classList.remove('show');
    });

    document.getElementById('menuAbout').addEventListener('click', () => {
      this.createTab('blynx://about');
      this.browserMenu.classList.remove('show');
    });

    document.getElementById('menuFind').addEventListener('click', () => {
      this.showFindBar();
      this.browserMenu.classList.remove('show');
    });

    // Find bar
    document.getElementById('findClose').addEventListener('click', () => {
      this.hideFindBar();
    });

    document.getElementById('findInput').addEventListener('input', (e) => {
      this.findInPage(e.target.value);
    });

    document.getElementById('findNext').addEventListener('click', () => {
      this.findNext();
    });

    document.getElementById('findPrev').addEventListener('click', () => {
      this.findPrevious();
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#menuBtn') && !e.target.closest('.browser-menu')) {
        this.browserMenu.classList.remove('show');
      }
    });

    // Allow dropping a dragged tab into this window's tab strip
    this.tabsContainer.addEventListener('dragover', (e) => {
      if (!this.draggingTabId) return;
      e.preventDefault();
      const over = e.target.closest('.tab');
      this._tabDragOverId = over ? Number(over.dataset.tabId) : null;
    });

    this.tabsContainer.addEventListener('drop', async (e) => {
      e.preventDefault();
      const marker = (e.dataTransfer && e.dataTransfer.getData('text/plain')) || '';
      const targetTabEl = e.target.closest('.tab');
      const beforeId = targetTabEl ? Number(targetTabEl.dataset.tabId) : null;

      if (marker === 'blynx-tab') {
        if (this.draggingTabId) {
          this._tabDragDidDropInThisWindow = true;
          this.reorderTab(this.draggingTabId, beforeId);
          return;
        }

        try {
          const payload = await window.electronAPI.tabDragClaim();
          if (payload && payload.url) {
            this.createTab(payload.url, true);
          }
        } catch (err) {
          console.error('Failed to claim dragged tab:', err);
        }
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'F12') {
        e.preventDefault();
        this.toggleDevTools();
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
        switch (e.key.toLowerCase()) {
          case 'i':
            e.preventDefault();
            this.toggleDevTools();
            return;
          case 'u':
            e.preventDefault();
            this.viewSourceCurrentTab();
            return;
        }
      }

      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 't':
            e.preventDefault();
            this.createTab('blynx://newtab');
            break;
          case 'w':
            e.preventDefault();
            this.closeCurrentTab();
            break;
          case 'l':
            e.preventDefault();
            this.urlInput.focus();
            this.urlInput.select();
            break;
          case 'k':
            e.preventDefault();
            this.urlInput.focus();
            this.urlInput.select();
            break;
          case 'f':
            e.preventDefault();
            this.showFindBar();
            break;
          case 'r':
            e.preventDefault();
            this.reload();
            break;
          case 'd':
            e.preventDefault();
            this.toggleBookmark();
            break;
        }
      }

      if (e.key === 'F5') {
        e.preventDefault();
        this.reload();
      }

      if (e.key === 'Escape') {
        this.hideFindBar();
      }
    });
  }

  setupIpcListeners() {
    // Listen for new tab requests from main process
    window.electronAPI.onNewTab((url) => {
      this.createTab(url);
    });

    window.electronAPI.onCloseCurrentTab(() => {
      this.closeCurrentTab();
    });

    window.electronAPI.onReloadCurrentTab(() => {
      this.reload();
    });

    window.electronAPI.onForceReloadCurrentTab(() => {
      this.forceReload();
    });

    window.electronAPI.onNavigateBack(() => {
      this.goBack();
    });

    window.electronAPI.onNavigateForward(() => {
      this.goForward();
    });

    window.electronAPI.onFocusAddressBar(() => {
      this.urlInput.focus();
      this.urlInput.select();
    });

    window.electronAPI.onBookmarkCurrentTab(() => {
      this.toggleBookmark();
    });

    window.electronAPI.onHistoryCleared(() => {
      // Refresh history page if open
      const historyTab = this.tabs.find(tab => tab.url && tab.url.startsWith('blynx://history'));
      if (historyTab) {
        historyTab.webview.reload();
      }
    });

    window.electronAPI.onNavigateTo((url) => {
      this.navigateTo(url);
    });

    window.electronAPI.onSettingChanged((key, value) => {
      console.log('Setting changed:', key, value);
      switch (key) {
        case 'showBookmarksBar':
          this.showBookmarksBar = value;
          this.updateBookmarkBarVisibility();
          break;
        case 'searchEngine':
          this.searchEngine = value;
          break;
        case 'homePage':
          this.homePage = value;
          break;
      }
    });

    window.electronAPI.onProfileChanged(() => {
      // Recreate webviews with the new partition
      window.location.reload();
    });
  }

  async loadSettings() {
    this.showBookmarksBar = await window.electronAPI.storeGet('showBookmarksBar', true);
    this.homePage = await window.electronAPI.storeGet('homePage', 'blynx://newtab');
    this.searchEngine = await window.electronAPI.storeGet('searchEngine', 'google');

    this.updateBookmarkBarVisibility();
    await this.renderBookmarkBar();
    await this.loadProfilesUi();
  }

  async loadProfilesUi() {
    if (!this.profileSelectMain) return;
    try {
      const profiles = await window.electronAPI.profilesList();
      const current = await window.electronAPI.profilesCurrent();
      this.profileSelectMain.innerHTML = (profiles || [])
        .map(p => `<option value="${p.id}">${p.name}</option>`)
        .join('');
      this.profileSelectMain.value = current;
    } catch (e) {
      console.error('Failed to load profiles UI:', e);
    }
  }

  async loadProfile() {
    try {
      const profileId = await window.electronAPI.profilesCurrent();
      this.currentProfileId = profileId || 'default';
      this.currentPartition = await window.electronAPI.ensureProfileSession(this.currentProfileId);
    } catch (e) {
      console.error('Failed to load profile, using default:', e);
      this.currentProfileId = 'default';
      this.currentPartition = 'persist:blynx-default';
    }
  }

  updateBookmarkBarVisibility() {
    if (this.showBookmarksBar) {
      this.bookmarkBar.classList.remove('hidden');
    } else {
      this.bookmarkBar.classList.add('hidden');
    }
  }

  async renderBookmarkBar() {
    const bookmarks = await window.electronAPI.getBookmarks();
    this.bookmarksContainer.innerHTML = '';

    if (bookmarks.length === 0) {
      // Show a message when no bookmarks
      const emptyMsg = document.createElement('div');
      emptyMsg.className = 'bookmark-item';
      emptyMsg.innerHTML = '<span style="color: #9aa0a6; font-style: italic;">No bookmarks yet - Press Ctrl+D to bookmark a page</span>';
      this.bookmarksContainer.appendChild(emptyMsg);
      return;
    }

    // Show first 10 bookmarks in the bar
    bookmarks.slice(0, 10).forEach(bookmark => {
      const item = document.createElement('div');
      item.className = 'bookmark-item';
      item.title = bookmark.title;
      item.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
        </svg>
        <span>${bookmark.title}</span>
      `;
      item.addEventListener('click', () => {
        this.navigateTo(bookmark.url);
      });

      item.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this.showBookmarkContextMenu(e.clientX, e.clientY, bookmark);
      });
      this.bookmarksContainer.appendChild(item);
    });

    // Add "More" button if there are more bookmarks
    if (bookmarks.length > 10) {
      const moreBtn = document.createElement('div');
      moreBtn.className = 'bookmark-item';
      moreBtn.innerHTML = '<span>»</span>';
      moreBtn.title = 'View all bookmarks';
      moreBtn.addEventListener('click', () => {
        this.createTab('blynx://bookmarks');
      });
      this.bookmarksContainer.appendChild(moreBtn);
    }
  }

  toggleBookmarkBar() {
    this.showBookmarksBar = !this.showBookmarksBar;
    this.updateBookmarkBarVisibility();
    window.electronAPI.storeSet('showBookmarksBar', this.showBookmarksBar);
  }

  ensureBookmarkContextMenu() {
    if (this.bookmarkContextMenu) return;

    const menu = document.createElement('div');
    menu.style.position = 'fixed';
    menu.style.zIndex = '2000';
    menu.style.minWidth = '180px';
    menu.style.background = 'var(--bg-secondary)';
    menu.style.border = '1px solid var(--bg-tertiary)';
    menu.style.borderRadius = '8px';
    menu.style.boxShadow = '0 4px 20px rgba(0, 0, 0, 0.35)';
    menu.style.padding = '6px 0';
    menu.style.display = 'none';

    document.body.appendChild(menu);
    this.bookmarkContextMenu = menu;

    document.addEventListener('click', () => this.hideBookmarkContextMenu());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.hideBookmarkContextMenu();
    });
  }

  hideBookmarkContextMenu() {
    if (this.bookmarkContextMenu) {
      this.bookmarkContextMenu.style.display = 'none';
      this.bookmarkContextMenu.innerHTML = '';
    }
  }

  addBookmarkContextMenuItem(label, onClick, danger = false) {
    const item = document.createElement('div');
    item.textContent = label;
    item.style.padding = '10px 14px';
    item.style.fontSize = '13px';
    item.style.cursor = 'pointer';
    item.style.userSelect = 'none';
    item.style.color = danger ? 'var(--accent-red)' : 'var(--text-primary)';
    item.addEventListener('mouseenter', () => {
      item.style.background = 'var(--bg-hover)';
    });
    item.addEventListener('mouseleave', () => {
      item.style.background = 'transparent';
    });
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideBookmarkContextMenu();
      onClick();
    });
    this.bookmarkContextMenu.appendChild(item);
  }

  showBookmarkContextMenu(x, y, bookmark) {
    this.ensureBookmarkContextMenu();

    this.bookmarkContextMenu.innerHTML = '';
    this.addBookmarkContextMenuItem('Open in new tab', () => this.createTab(bookmark.url));
    this.addBookmarkContextMenuItem('Copy link', async () => {
      try {
        await navigator.clipboard.writeText(bookmark.url);
      } catch {
        // ignore
      }
    });
    this.addBookmarkContextMenuItem('Delete', async () => {
      await window.electronAPI.removeBookmark(bookmark.id);
      this.renderBookmarkBar();
      if (this.activeTabId) {
        const tab = this.tabs.find(t => t.id === this.activeTabId);
        if (tab) this.updateBookmarkButton(tab.displayUrl || tab.url);
      }
    }, true);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    this.bookmarkContextMenu.style.left = '0px';
    this.bookmarkContextMenu.style.top = '0px';
    this.bookmarkContextMenu.style.display = 'block';
    const rect = this.bookmarkContextMenu.getBoundingClientRect();
    const left = Math.min(x, vw - rect.width - 8);
    const top = Math.min(y, vh - rect.height - 8);
    this.bookmarkContextMenu.style.left = left + 'px';
    this.bookmarkContextMenu.style.top = top + 'px';
  }

  createTab(url = 'blynx://newtab', activate = true) {
    const tabId = ++this.tabIdCounter;
    const tab = {
      id: tabId,
      url: url,
      displayUrl: url,
      actualUrl: url,
      title: 'New Tab',
      favicon: null,
      loading: false,
      canGoBack: false,
      canGoForward: false
    };

    this.tabs.push(tab);

    // Create tab element
    const tabElement = this.createTabElement(tab);
    this.tabsContainer.appendChild(tabElement);

    // Create webview with blank src initially
    const webview = this.createWebview(tabId);
    this.webviewContainer.appendChild(webview);
    tab.webview = webview;

    if (activate) {
      this.activateTab(tabId);
      // Navigate to the URL after activation
      this.navigateTo(url);
    } else {
      // Fire-and-forget, but make sure async internal URL resolution runs
      this.loadUrlInTab(tabId, url).catch(e => console.error('Failed to load URL in background tab:', e));
    }

    this.persistSessionTabs();

    // Scroll to new tab
    tabElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    return tab;
  }

  createTabElement(tab) {
    const div = document.createElement('div');
    div.className = 'tab';
    div.dataset.tabId = tab.id;
    div.draggable = true;

    div.innerHTML = `
      <div class="tab-icon">
        <img src="" alt="" style="display: none;">
        <div class="tab-loading" style="display: none;"></div>
      </div>
      <span class="tab-title">New Tab</span>
      <button class="tab-close" title="Close tab">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    `;

    // Tab click to activate
    div.addEventListener('click', (e) => {
      if (!e.target.closest('.tab-close')) {
        this.activateTab(tab.id);
      }
    });

    // Close button
    const closeBtn = div.querySelector('.tab-close');
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tab.id);
    });

    // Middle click to close
    div.addEventListener('auxclick', (e) => {
      if (e.button === 1) {
        this.closeTab(tab.id);
      }
    });

    div.addEventListener('dragstart', (e) => {
      this.draggingTabId = tab.id;
      this._tabDragDidDropInThisWindow = false;
      try {
        if (e.dataTransfer) {
          e.dataTransfer.setData('text/plain', 'blynx-tab');
          e.dataTransfer.effectAllowed = 'move';
        }
      } catch {
        // ignore
      }

      try {
        window.electronAPI.tabDragStart({
          url: tab.displayUrl || tab.url,
          profileId: this.currentProfileId || null
        });
      } catch {
        // ignore
      }
    });

    div.addEventListener('dragend', async () => {
      const endedTabId = this.draggingTabId;
      this.draggingTabId = null;
      this._tabDragOverId = null;

      if (this._tabDragDidDropInThisWindow) {
        this._tabDragDidDropInThisWindow = false;
        return;
      }

      if (!endedTabId) return;

      try {
        const claimed = await window.electronAPI.tabDragWasClaimed();
        if (claimed) {
          this.closeTab(endedTabId);
          return;
        }
      } catch {
        // ignore
      }

      // If it wasn't claimed by another window, tear it off into a new window
      const endedTab = this.tabs.find(t => t.id === endedTabId);
      if (!endedTab) return;
      const u = endedTab.displayUrl || endedTab.url;
      try {
        await window.electronAPI.createWindowWithTab({
          url: u,
          profileId: this.currentProfileId || null
        });
        this.closeTab(endedTabId);
      } catch (err) {
        console.error('Failed to tear off tab:', err);
      }
    });

    return div;
  }

  reorderTab(tabId, beforeTabId) {
    if (!tabId || tabId === beforeTabId) return;
    const fromIndex = this.tabs.findIndex(t => t.id === tabId);
    if (fromIndex === -1) return;

    const tabEl = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!tabEl) return;

    const [moved] = this.tabs.splice(fromIndex, 1);

    if (!beforeTabId) {
      this.tabs.push(moved);
      this.tabsContainer.appendChild(tabEl);
      this.persistSessionTabs();
      return;
    }

    const toIndex = this.tabs.findIndex(t => t.id === beforeTabId);
    const beforeEl = this.tabsContainer.querySelector(`[data-tab-id="${beforeTabId}"]`);
    if (toIndex === -1 || !beforeEl) {
      this.tabs.push(moved);
      this.tabsContainer.appendChild(tabEl);
      this.persistSessionTabs();
      return;
    }

    this.tabs.splice(toIndex, 0, moved);
    this.tabsContainer.insertBefore(tabEl, beforeEl);
    this.persistSessionTabs();
  }

  createWebview(tabId) {
    const webview = document.createElement('webview');
    webview.setAttribute('src', 'about:blank');
    webview.setAttribute('allowpopups', 'true');
    webview.setAttribute('partition', this.currentPartition);
    webview.setAttribute('webpreferences', 'contextIsolation=yes,nodeIntegration=no,webviewTag=yes');
    if (this.internalPreloadPath) {
      webview.setAttribute('preload', this.internalPreloadPath);
    }
    webview.dataset.tabId = tabId;
    
    // Add error handling
    webview.addEventListener('did-fail-load', (e) => {
      console.error('Webview failed to load:', e);
    });

    // Webview events
    webview.addEventListener('loadstart', () => {
      this.handleLoadStart(tabId);
    });

    webview.addEventListener('loadstop', () => {
      this.handleLoadStop(tabId);
    });

    webview.addEventListener('did-navigate', (e) => {
      this.handleDidNavigate(tabId, e.url);
    });

    webview.addEventListener('did-navigate-in-page', (e) => {
      this.handleDidNavigate(tabId, e.url, true);
    });

    webview.addEventListener('page-title-updated', (e) => {
      this.handleTitleUpdate(tabId, e.title);
    });

    webview.addEventListener('page-favicon-updated', (e) => {
      this.handleFaviconUpdate(tabId, e.favicons[0]);
    });

    webview.addEventListener('new-window', (e) => {
      // Prevent Electron from attempting to create a guest window that can end up blank
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      const targetUrl = e && (e.url || e.targetUrl);
      if (targetUrl) {
        this.createTab(targetUrl);
      }
    });

    webview.addEventListener('context-menu', (e) => {
      // Handle context menu
    });

    return webview;
  }

  activateTab(tabId) {
    if (this.activeTabId === tabId) return;

    // Deactivate current tab
    if (this.activeTabId) {
      const currentTabEl = this.tabsContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
      const currentWebview = this.webviewContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
      if (currentTabEl) currentTabEl.classList.remove('active');
      if (currentWebview) currentWebview.classList.remove('active');
    }

    // Activate new tab
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    this.activeTabId = tabId;
    const tabEl = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${tabId}"]`);

    if (tabEl) tabEl.classList.add('active');
    if (webview) webview.classList.add('active');

    // Update URL bar
    this.updateAddressBar(tab);

    // Update navigation buttons
    this.updateNavigationButtons(tab);

    // Update bookmark button
    this.updateBookmarkButton(tab.url);

    // Update security icon
    this.updateSecurityIcon(tab.url);
  }

  closeTab(tabId) {
    const tabIndex = this.tabs.findIndex(t => t.id === tabId);
    if (tabIndex === -1) return;

    const tab = this.tabs[tabIndex];

    // Remove elements
    const tabEl = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${tabId}"]`);

    if (tabEl) tabEl.remove();
    if (webview) webview.remove();

    // Remove from array
    this.tabs.splice(tabIndex, 1);

    // If this was the active tab, activate another
    if (this.activeTabId === tabId) {
      if (this.tabs.length > 0) {
        // Try to activate tab to the right, otherwise to the left
        const newIndex = Math.min(tabIndex, this.tabs.length - 1);
        this.activateTab(this.tabs[newIndex].id);
      } else {
        this.activeTabId = null;
        this.urlInput.value = '';
        // Always keep at least one tab open
        this.createTab('blynx://newtab');
      }
    }

    this.persistSessionTabs();
  }

  closeCurrentTab() {
    if (this.activeTabId) {
      this.closeTab(this.activeTabId);
    }
  }

  handleLoadStart(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    tab.loading = true;
    const tabEl = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabEl) {
      const favicon = tabEl.querySelector('.tab-icon img');
      const loading = tabEl.querySelector('.tab-loading');
      favicon.style.display = 'none';
      loading.style.display = 'block';
    }

    // Update reload button to stop button
    this.updateReloadButton(true);
  }

  handleLoadStop(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    tab.loading = false;
    const tabEl = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabEl) {
      const favicon = tabEl.querySelector('.tab-icon img');
      const loading = tabEl.querySelector('.tab-loading');
      loading.style.display = 'none';
      if (tab.favicon) {
        favicon.src = tab.favicon;
        favicon.style.display = 'block';
      }
    }

    // Update reload button back to reload
    if (this.activeTabId === tabId) {
      this.updateReloadButton(false);
    }

    // Add to history
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (webview) {
      webview.executeJavaScript('document.title', false).then(title => {
        window.electronAPI.addHistory({
          url: tab.url,
          title: title || tab.url
        });

        const historyTab = this.tabs.find(t => t.displayUrl === 'blynx://history' || t.url === 'blynx://history');
        if (historyTab && historyTab.webview) {
          historyTab.webview.reload();
        }
      });
    }

    // Update navigation state
    this.updateNavigationState(tabId);
  }

  handleDidNavigate(tabId, url, isInPage = false) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    // Map internal file URLs back to blynx:// for display purposes
    if (url.startsWith('file://') && url.includes('/internal/')) {
      const lower = url.toLowerCase();
      const fileToBlynx = [
        ['settings.html', 'blynx://settings'],
        ['history.html', 'blynx://history'],
        ['bookmarks.html', 'blynx://bookmarks'],
        ['downloads.html', 'blynx://downloads'],
        ['extensions.html', 'blynx://extensions'],
        ['about.html', 'blynx://about'],
        ['newtab.html', 'blynx://newtab']
      ];
      const mapped = fileToBlynx.find(([f]) => lower.includes('/internal/' + f));
      if (mapped) {
        tab.displayUrl = mapped[1];
        tab.url = mapped[1];
        tab.actualUrl = url;
      }
    }

    // If navigating to an internal file:// URL, keep showing blynx:// in address bar
    if (url.startsWith('file://') && tab.displayUrl && tab.displayUrl.startsWith('blynx://')) {
      tab.url = tab.displayUrl;
      tab.actualUrl = url;
    } else {
      tab.url = url;
      tab.displayUrl = url;
      tab.actualUrl = url;
    }

    if (this.activeTabId === tabId) {
      // Show displayUrl (blynx://) in address bar for internal pages
      this.urlInput.value = tab.displayUrl || tab.url;
      this.updateSecurityIcon(tab.displayUrl || tab.url);
      this.updateBookmarkButton(tab.displayUrl || tab.url);
    }

    if (!isInPage) {
      this.updateNavigationState(tabId);
    }

    // Force dark background for generic file:// pages and for view-source pages
    if (!isInPage) {
      const isInternal = (tab.displayUrl || tab.url || '').startsWith('blynx://');
      const actual = tab.actualUrl || url || '';
      const isFile = actual.startsWith('file://');
      const isViewSource = actual.startsWith('view-source:');
      if ((isFile && !isInternal) || isViewSource) {
        const wv = this.webviewContainer.querySelector(`[data-tab-id="${tabId}"]`);
        if (wv) {
          wv.executeJavaScript(`(() => {
            try {
              const styleId = 'blynx-file-theme';
              let st = document.getElementById(styleId);
              if (!st) {
                st = document.createElement('style');
                st.id = styleId;
                document.documentElement.appendChild(st);
              }
              const base = 'html,body{background:#1B1B1B !important}';
              if (${isViewSource ? 'true' : 'false'}) {
                st.textContent = base + 'html,body,pre,code{color:#e8eaed !important} a{color:#8ab4f8 !important}';
              } else {
                // Keep site text styles; only ensure dark background
                st.textContent = base;
              }
            } catch (_) {}
          })();`, false).catch(() => {});
        }
      }
    }

    // Record history on committed navigation (more reliable than loadstop)
    if (!isInPage) {
      const u = tab.displayUrl || tab.url;
      const shouldRecord =
        typeof u === 'string' &&
        u.length > 0 &&
        !u.startsWith('blynx://') &&
        !u.startsWith('file://') &&
        u !== 'about:blank';
      if (shouldRecord) {
        window.electronAPI.addHistory({
          url: u,
          title: tab.title || u
        });

        const historyTab = this.tabs.find(t => t.displayUrl === 'blynx://history' || t.url === 'blynx://history');
        if (historyTab && historyTab.webview) {
          historyTab.webview.reload();
        }
      }
    }

    this.persistSessionTabs();
  }

  handleTitleUpdate(tabId, title) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    tab.title = title;
    const tabEl = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabEl) {
      const titleEl = tabEl.querySelector('.tab-title');
      titleEl.textContent = title || 'Loading...';
    }

    // Update window title
    if (this.activeTabId === tabId) {
      document.title = title ? `${title} - Blynx` : 'Blynx Browser';
    }
  }

  handleFaviconUpdate(tabId, faviconUrl) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    tab.favicon = faviconUrl;
    const tabEl = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (tabEl && faviconUrl) {
      const favicon = tabEl.querySelector('.tab-icon img');
      const loading = tabEl.querySelector('.tab-loading');
      favicon.src = faviconUrl;
      favicon.style.display = 'block';
      loading.style.display = 'none';
    }
  }

  updateNavigationState(tabId) {
    const tab = this.tabs.find(t => t.id === tabId);
    if (!tab) return;

    const webview = this.webviewContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (!webview) return;

    tab.canGoBack = webview.canGoBack();
    tab.canGoForward = webview.canGoForward();

    if (this.activeTabId === tabId) {
      this.updateNavigationButtons(tab);
    }
  }

  updateNavigationButtons(tab) {
    this.backBtn.disabled = !tab.canGoBack;
    this.forwardBtn.disabled = !tab.canGoForward;
  }

  updateAddressBar(tab) {
    // Show displayUrl (blynx://) in address bar
    this.urlInput.value = tab.displayUrl || tab.url || '';
    this.updateSecurityIcon(tab.displayUrl || tab.url);
    this.updateBookmarkButton(tab.displayUrl || tab.url);
  }

  updateSecurityIcon(url) {
    const icon = this.securityIcon;
    icon.classList.remove('secure', 'insecure');

    if (!url || url.startsWith('blynx://') || url.startsWith('file://')) {
      icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="16" x2="12" y2="12"/>
          <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
      `;
    } else if (url.startsWith('https://')) {
      icon.classList.add('secure');
      icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      `;
    } else {
      icon.classList.add('insecure');
      icon.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
      `;
    }
  }

  async updateBookmarkButton(url) {
    const bookmarks = await window.electronAPI.getBookmarks();
    const isBookmarked = bookmarks.some(b => b.url === url);

    if (isBookmarked) {
      this.bookmarkBtn.classList.add('active');
    } else {
      this.bookmarkBtn.classList.remove('active');
    }
  }

  updateReloadButton(loading) {
    if (loading) {
      this.reloadBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      `;
      this.reloadBtn.title = 'Stop';
    } else {
      this.reloadBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="23,4 23,10 17,10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
      `;
      this.reloadBtn.title = 'Reload';
    }
  }

  async handleAddressInput(input) {
    let url = input.trim();

    if (!url) return;

    if (url.startsWith('view-source:')) {
      const target = url.slice('view-source:'.length);
      const cleaned = target.trim();
      if (cleaned) {
        await this.navigateTo(`view-source:${cleaned}`);
      }
      return;
    }

    // Handle blynx:// URLs (internal pages)
    if (url.startsWith('blynx://')) {
      await this.navigateTo(url);
      return;
    }

    // Handle file:// URLs
    if (url.startsWith('file://')) {
      await this.navigateTo(url);
      return;
    }

    // Check if it's already a complete URL with protocol
    if (url.match(/^https?:\/\//i)) {
      await this.navigateTo(url);
      return;
    }

    // Check if it looks like a URL (has TLD or localhost)
    // This regex checks for: domain.tld or domain.tld/path or domain.tld:port
    const urlPattern = /^(localhost|(\d{1,3}\.){3}\d{1,3}|([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,})(:\d+)?(\/\S*)?$/i;

    if (urlPattern.test(url)) {
      // It's a URL - add https://
      await this.navigateTo('https://' + url);
      return;
    }

    // It's a search query - use the configured search engine
    try {
      const searchUrl = await window.electronAPI.getSearchUrl(url);
      await this.navigateTo(searchUrl);
    } catch (e) {
      // Fallback to Google if something goes wrong
      await this.navigateTo('https://www.google.com/search?q=' + encodeURIComponent(url));
    }
  }

  async navigateTo(url) {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab) return;
    await this.loadUrlInTab(this.activeTabId, url);
  }

  goBack() {
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    if (webview && webview.canGoBack()) {
      webview.goBack();
    }
  }

  goForward() {
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    if (webview && webview.canGoForward()) {
      webview.goForward();
    }
  }

  reload() {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab) return;

    const webview = this.webviewContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    if (webview) {
      if (tab.loading) {
        webview.stop();
      } else {
        webview.reload();
      }
    }
  }

  forceReload() {
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    if (webview) {
      webview.reloadIgnoringCache();
    }
  }

  async toggleBookmark() {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab) return;

    const bookmarks = await window.electronAPI.getBookmarks();
    // Use displayUrl if available (blynx://), otherwise use actual url
    const bookmarkUrl = tab.displayUrl || tab.url;
    const existing = bookmarks.find(b => b.url === bookmarkUrl);

    if (existing) {
      await window.electronAPI.removeBookmark(existing.id);
      this.bookmarkBtn.classList.remove('active');
    } else {
      await window.electronAPI.addBookmark({
        url: bookmarkUrl,
        title: tab.title || bookmarkUrl
      });
      this.bookmarkBtn.classList.add('active');
    }

    // Refresh the bookmark bar
    await this.renderBookmarkBar();

    const bookmarksTab = this.tabs.find(t => t.displayUrl === 'blynx://bookmarks' || t.url === 'blynx://bookmarks');
    if (bookmarksTab && bookmarksTab.webview) {
      bookmarksTab.webview.reload();
    }
  }

  showFindBar() {
    this.findBar.classList.add('show');
    document.getElementById('findInput').focus();
    document.getElementById('findInput').select();
  }

  hideFindBar() {
    this.findBar.classList.remove('show');
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    if (webview) {
      webview.stopFindInPage('clearSelection');
    }
  }

  findInPage(text) {
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    if (!webview) return;

    if (text) {
      webview.findInPage(text);
    } else {
      webview.stopFindInPage('clearSelection');
      document.getElementById('findMatches').textContent = '';
    }
  }

  findNext() {
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    if (webview) {
      const text = document.getElementById('findInput').value;
      if (text) webview.findInPage(text, { findNext: true });
    }
  }

  findPrevious() {
    const webview = this.webviewContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
    if (webview) {
      const text = document.getElementById('findInput').value;
      if (text) webview.findInPage(text, { forward: false, findNext: true });
    }
  }

  updateMaximizeButton() {
    const btn = document.getElementById('maximizeBtn');
    if (this.windowMaximized) {
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
        </svg>
      `;
      btn.title = 'Restore';
    } else {
      btn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
        </svg>
      `;
      btn.title = 'Maximize';
    }
  }
}

// Initialize browser when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.browser = new BrowserController();
});
