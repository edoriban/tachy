# 📁 Tachy

A modern, fast, and beautiful file explorer for Windows 11, built with **Rust** (Tauri) and **React**.

![Windows 11](https://img.shields.io/badge/Windows%2011-0078D6?style=for-the-badge&logo=windows&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Tauri](https://img.shields.io/badge/Tauri-24C8DB?style=for-the-badge&logo=tauri&logoColor=white)

## ✨ Features

- **⚡ Blazing Fast** - Rust-powered file system operations for instant navigation
- **🎨 Modern UI** - Windows 11 Fluent Design with automatic dark/light theme
- **🔍 Quick Search** - Recursive file search with real-time results
- **📂 Quick Access** - Easy access to common folders (Desktop, Downloads, Documents, etc.)
- **💾 Drive Navigation** - Browse all available drives on your system
- **📋 Dual View Modes** - Switch between Grid and List views
- **⌨️ Keyboard Friendly** - Navigate with ease using keyboard shortcuts
- **🪶 Lightweight** - Small footprint thanks to Tauri (no Electron bloat!)

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- [pnpm](https://pnpm.io/) (recommended) or npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/tachy.git
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

## 🏗️ Project Structure

```
tachy/
├── src/                    # React frontend
│   ├── components/         # UI components
│   │   ├── Sidebar.tsx     # Navigation sidebar
│   │   ├── Toolbar.tsx     # Top toolbar with navigation
│   │   ├── FileGrid.tsx    # Grid view for files
│   │   └── FileList.tsx    # List view for files
│   ├── utils/              # Utility functions
│   │   ├── icons.tsx       # SVG icon components
│   │   └── format.ts       # Size/date formatters
│   ├── types.ts            # TypeScript interfaces
│   ├── App.tsx             # Main application component
│   └── App.css             # Tailwind CSS styles
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── lib.rs          # Tauri commands (file operations)
│   │   └── main.rs         # Application entry point
│   ├── Cargo.toml          # Rust dependencies
│   └── tauri.conf.json     # Tauri configuration
└── package.json            # Node.js dependencies
```

## 🛠️ Technology Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Rust + Tauri v2 |
| **Frontend** | React 19 + TypeScript |
| **Styling** | Tailwind CSS v4 |
| **Build Tool** | Vite 7 |
| **File Operations** | `walkdir`, `chrono` (Rust crates) |

## 📝 Available Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm tauri dev` | Run the app in development mode |
| `pnpm tauri build` | Build for production |
| `pnpm build` | Build frontend only |

## 🎯 Roadmap

- [ ] File operations (copy, move, delete, rename)
- [ ] Context menu with file actions
- [ ] Favorites/bookmarks
- [ ] Tabs for multiple locations
- [ ] File preview pane
- [ ] Keyboard shortcuts overlay
- [ ] Custom themes

## 📄 License

MIT License - feel free to use this project for personal and commercial purposes.

---

Made with ❤️ using Rust and React
