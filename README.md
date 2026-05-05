# 📁 Tachy

A modern, fast, and beautiful file explorer for **Windows 11**, built with **Rust** (Tauri 2) and **React 19**.

![Windows 11](https://img.shields.io/badge/Windows%2011-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Tauri](https://img.shields.io/badge/Tauri-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)

> ⚠️ **Windows 11 only.** Tachy uses Mica window effects, the Windows Cloud Files API, the Shell `IContextMenu`, and the modern Windows Share dialog. It will **not** run on macOS or Linux.

<!-- TODO: add screenshot at docs/screenshot.png -->

## ✨ Features

- **⚡ Blazing Fast** — Rust-powered file system operations for instant navigation
- **🎨 Modern UI** — Windows 11 Fluent Design with Mica, automatic dark/light theme
- **🪟 Custom Window** — Frameless window with native-feeling controls and transparency
- **🔍 Quick Search** — Recursive file search with real-time results
- **📂 Quick Access** — Pin any folder for one-click access
- **💾 Drive Navigation** — Browse all available drives on your system
- **📋 Dual View Modes** — Switch between Grid and List views
- **🖼️ Thumbnails** — Real Windows shell thumbnails for images, videos, and documents
- **👁️ Preview Pane** — Inline preview for images, text, PDFs, and more
- **🗂️ File Operations** — Copy, move, delete, rename, and clipboard support
- **🖱️ Native Context Menu** — Full Windows shell context menu (Open With, Send To, third-party entries)
- **☁️ Cloud Sync Indicators** — OneDrive / cloud sync state badges (online-only, locally available, pinned)
- **📤 Native Share** — Hands off to the Windows modern share sheet
- **🏠 Home View** — Aggregated dashboard with Quick Access and recents
- **⌨️ Keyboard Friendly** — Common shortcuts wired up out of the box

## ⚖️ Honest Tradeoffs

Tachy is built on Tauri + WebView2, not native Win32. That choice has real costs — here's the unvarnished version so you can decide if it fits your machine:

- **Install size:** ~6 MB. WebView2 ships with Windows 11, so we don't bundle a browser. Electron-equivalent file managers tend to land at 150 MB+.
- **Cold-start RAM (no other WebView2 apps running):** ~140 MB total — roughly 109 MB for the shared WebView2 Manager process, ~30 MB for the renderer, and ~10 MB for the Rust process.
- **Marginal RAM (when Edge or other WebView2 apps are already running):** the Manager process is shared, so Tachy's added cost drops to ~30–40 MB.
- **Native `explorer.exe` is still lighter** at ~105 MB resident — but that one process hosts the desktop, taskbar, Start menu, and every File Explorer window at once, so it's not a clean apples-to-apples comparison.

We're not pretending to beat native. The pitch is a modern UI on top of comparable-or-slightly-higher overhead than the built-in shell, and a fraction of what an Electron equivalent would cost.

## 📥 Download

[![Latest Release](https://img.shields.io/github/v/release/edoriban/tachy?include_prereleases&style=for-the-badge&label=Latest%20Release)](https://github.com/edoriban/tachy/releases/latest)

Grab the newest installer from the [**Releases page**](https://github.com/edoriban/tachy/releases/latest):

| Installer        | When to pick it                                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| **`.exe` (NSIS)** | Recommended for most users. Lightweight, friendly first-run experience, per-user install by default.    |
| **`.msi`**        | Recommended for enterprise / managed environments, group policy deployment, and `winget` packaging.     |

Both installers ship the same app — pick whichever fits your environment.

> Tachy is currently unsigned. Windows SmartScreen may show a warning the first time you run it; click **More info → Run anyway** to continue. Code signing is on the roadmap.

## 🔄 Auto-update

Starting with **v0.1.3**, Tachy checks GitHub Releases on launch for a newer version. When one is available a discreet banner appears at the top of the window with **Install & restart** and **Later** buttons. Choosing install downloads the new bundle, verifies its cryptographic signature against an embedded public key, applies the update, and relaunches the app.

- **Signed.** Every update artifact is signed with a private key held by the maintainer; tampered or unsigned bundles are rejected by the client.
- **No telemetry.** The only outbound request is a single GET to `https://github.com/edoriban/tachy/releases/latest/download/latest.json` on launch. No analytics, no identifiers, no phoning home beyond that version manifest.
- **Opt-out by ignoring it.** Hit **Later** and the banner stays hidden for the rest of the session — there is no scheduled retry, popup, or background download.

## 🛠️ Technology Stack

| Layer                   | Technology                                                          |
| ----------------------- | ------------------------------------------------------------------- |
| **Backend**             | Rust + Tauri 2 (`windows`, `windows-core`, `walkdir`, `chrono`)     |
| **Frontend**            | React 19 + TypeScript                                               |
| **State**               | Zustand 5                                                           |
| **Styling**             | Tailwind CSS 4                                                      |
| **Build Tool**          | Vite 7                                                              |
| **Virtualization**      | `@tanstack/react-virtual`                                           |
| **Package Manager**     | pnpm                                                                |

## 🏗️ Project Structure

```
tachy/
├── src/                              # React frontend
│   ├── components/
│   │   ├── common/                   # Dialog, PropertiesDialog, WindowControls
│   │   ├── file-browser/             # FileGrid, FileList, FileItem, HomeView,
│   │   │                             # Thumbnail, CloudBadge
│   │   └── layout/                   # Sidebar, Toolbar, StatusBar, TabBar,
│   │                                 # PreviewPanel, TreeItem
│   ├── hooks/                        # useContextMenu, useFileOperations,
│   │                                 # useKeyboardNavigation, useKeyboardShortcuts,
│   │                                 # useThumbnail
│   ├── services/                     # fileService, systemService, thumbnailService
│   ├── store/                        # Zustand stores (app, tabs, clipboard,
│   │                                 # pinned, folderPrefs)
│   ├── types/                        # Shared TS types (file, tab, clipboard)
│   ├── utils/                        # icons, format helpers
│   ├── App.tsx                       # Main application component
│   └── main.tsx                      # React entry point
├── src-tauri/                        # Rust backend
│   ├── src/
│   │   └── main.rs                   # Tauri commands + Windows shell integrations
│   ├── capabilities/                 # Tauri capability/permission manifests
│   ├── icons/                        # App icons
│   ├── Cargo.toml                    # Rust dependencies
│   └── tauri.conf.json               # Tauri / bundle configuration
├── .github/workflows/release.yml     # Automated release pipeline
├── LICENSE                           # MIT
└── package.json                      # Node.js dependencies
```

## 📝 Available Commands

| Command            | Description                                       |
| ------------------ | ------------------------------------------------- |
| `pnpm dev`         | Start the Vite dev server                         |
| `pnpm tauri dev`   | Run the app in development mode                   |
| `pnpm tauri build` | Build production installers (`.msi` and `.exe`)   |
| `pnpm build`       | Build the frontend only                           |

## 🏗️ Building from Source

### Prerequisites

- [Node.js](https://nodejs.org/) v20 or higher
- [pnpm](https://pnpm.io/) v9 (Corepack: `corepack enable && corepack prepare pnpm@9 --activate`)
- [Rust](https://www.rust-lang.org/tools/install) stable toolchain
- Windows 11 with the **Microsoft Visual C++ Build Tools** (Desktop development with C++)
- [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Windows 11)

### Steps

1. Clone the repository:

   ```bash
   git clone https://github.com/edoriban/tachy.git
   cd tachy
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Run in development mode:

   ```bash
   pnpm tauri dev
   ```

4. Build for production:

   ```bash
   pnpm tauri build
   ```

   Installers are written to:

   - `src-tauri/target/release/bundle/msi/Tachy_<version>_x64_en-US.msi`
   - `src-tauri/target/release/bundle/nsis/Tachy_<version>_x64-setup.exe`

## 📦 Releases

Releases are fully automated via [GitHub Actions](.github/workflows/release.yml). The pipeline triggers when a tag matching `v*` is pushed:

```bash
# from a clean main branch with the version bumped in
# package.json and src-tauri/tauri.conf.json
git tag v0.1.0
git push origin v0.1.0
```

The workflow runs on `windows-latest`, builds both bundle targets, and creates a **draft GitHub Release** with the `.msi` and `.exe` attached. Review the draft, edit the notes if you want, then publish.

## 🎯 Roadmap

- [ ] Tabs for multiple locations
- [ ] Favorites / bookmarks
- [ ] Custom themes
- [ ] Keyboard shortcuts overlay
- [ ] Code signing for installers (no SmartScreen warning)
- [x] Auto-updater (v0.1.3+)
- [ ] Localization

## 🤝 Contributing

PRs welcome! For larger changes, please open an issue first so we can discuss the approach. For small fixes (typos, bugs, polish), feel free to send a PR directly.

## 📄 License

[MIT](./LICENSE) — feel free to use this project for personal and commercial purposes.

---

Made with ❤️ using Rust and React.
