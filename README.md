# Blynx Browser

A full-featured web browser built with Electron, featuring a modern Chrome-like interface with custom protocol support.

![Blynx Browser](src/assets/Blynx-Product.png)

## Features

- **Tab Management** - Create, close, and switch between multiple tabs
- **Tab Dragging** - Reorder tabs by dragging; drag a tab out to open it in a new window; drag between windows to move tabs
- **Custom Protocols** - `blynx://settings`, `blynx://history`, `blynx://bookmarks`, `blynx://downloads`, `blynx://extensions`, `blynx://about`, `blynx://newtab`
- **Modern UI** - Dark theme with a clean, intuitive interface
- **Bookmarks** - Save and manage your favorite websites
- **History** - View and manage browsing history
- **Navigation** - Back, forward, reload, and home buttons
- **Address Bar** - Smart URL parsing and search integration
- **View Source** - Supports `view-source:https://...` (and `Ctrl+Shift+U`)
- **Window Controls** - Minimize, maximize, and close with custom title bar
- **Keyboard Shortcuts** - Full keyboard navigation support
- **Find in Page** - Search within current page
- **Secure Browsing** - HTTPS indicators and security warnings

## Data Storage

Persistent browser data is stored inside the project at:

- `src/userdata/`

This includes per-profile data, bookmarks, history, settings, and session restore state.

## Installation

1. Clone or download this repository
2. Install dependencies:
```bash
npm install
```

## Usage

### Development Mode
```bash
npm run dev
```

### Production Build
```bash
# Build for current platform
npm run build

# Build for specific platforms
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

### Start the Browser
```bash
npm start
```

## Project Structure

```
blynx-browser/
├── src/
│   ├── main.js              # Main Electron process
│   ├── preload.js           # Preload script for secure IPC
│   ├── renderer/
│   │   ├── browser.html     # Main browser UI
│   │   ├── browser.css      # Browser styles
│   │   └── browser.js       # Browser UI controller
│   └── internal/
│       ├── newtab.html      # New tab page
│       ├── settings.html    # Settings page
│       ├── history.html     # History page
│       ├── bookmarks.html   # Bookmarks page
│       ├── downloads.html   # Downloads page
│       ├── about.html       # About page
│       └── extensions.html  # Extensions page
├── assets/                  # Icons and images
├── package.json
└── README.md
```

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + T` | New Tab |
| `Ctrl/Cmd + W` | Close Tab |
| `Ctrl/Cmd + L` | Focus Address Bar |
| `Ctrl/Cmd + R` | Reload Page |
| `Ctrl/Cmd + F` | Find in Page |
| `Ctrl/Cmd + D` | Bookmark Page |
| `F5` | Reload Page |
| `F12` | Toggle DevTools |
| `Ctrl+Shift+I` | Toggle DevTools |
| `Ctrl+Shift+U` | View Source for Current Page |
| `Esc` | Close Find Bar |
| `Alt + Left` | Go Back |
| `Alt + Right` | Go Forward |

## Custom Protocols

Blynx supports custom internal protocols:

- `blynx://newtab` - New tab page with search and shortcuts
- `blynx://settings` - Browser settings and preferences
- `blynx://history` - Browsing history
- `blynx://bookmarks` - Saved bookmarks
- `blynx://downloads` - Download manager
- `blynx://extensions` - Extension management (coming soon)
- `blynx://about` - About Blynx

## Technologies Used

- [Electron](https://electronjs.org/) - Cross-platform desktop apps
- [Chromium](https://www.chromium.org/) - Web rendering engine
- [Node.js](https://nodejs.org/) - JavaScript runtime
- [electron-store](https://github.com/sindresorhus/electron-store) - Data persistence

## License

MIT License - See LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

For support, please open an issue on the project repository.

---

**Enjoy browsing with Blynx!**
