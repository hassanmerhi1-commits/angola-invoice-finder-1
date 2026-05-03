# NEXOR ERP - Desktop App Setup

This guide shows you how to build and run NEXOR ERP as a standalone desktop application (.exe for Windows).

## Prerequisites

- Node.js 18+ installed
- Git installed
- For Windows builds: Windows 10/11
- For Mac builds: macOS with Xcode

## Quick Start (Development Mode)

```bash
# 1. Clone your repository
git clone <your-repo-url>
cd <project-folder>

# 2. Install dependencies
npm install

# 3. Run in development mode (with hot-reload)
npm run electron:dev
```

This opens the app as a desktop window while still having hot-reload for development.

## Build Standalone .exe

```bash
# 1. Build the web app
npm run build

# 2. Package as Windows installer (.exe)
npm run electron:build

# 3. Find your files in the /release folder:
#    - NEXOR-ERP-1.0.0-x64.exe (Installer)
#    - NEXOR-ERP-Portable-1.0.0.exe (No install needed)
```

## Available Commands

| Command | Description |
|---------|-------------|
| `npm run electron:dev` | Run app in development mode |
| `npm run electron:build` | Build .exe installer |
| `npm run build` | Build web app only |

## Package.json Scripts to Add

Add these to your `package.json` scripts section:

```json
{
  "scripts": {
    "electron:dev": "concurrently \"npm run dev\" \"wait-on http://localhost:5173 && ELECTRON_DEV=true electron .\"",
    "electron:build": "npm run build && electron-builder --win",
    "electron:build:mac": "npm run build && electron-builder --mac",
    "electron:build:linux": "npm run build && electron-builder --linux",
    "electron:build:all": "npm run build && electron-builder --win --mac --linux"
  },
  "main": "electron/main.cjs"
}
```

## Folder Structure

```
project/
├── electron/
│   ├── main.js        # Electron main process
│   └── preload.js     # Security bridge
├── src/               # React app source
├── dist/              # Built web app (after npm run build)
├── release/           # Built desktop apps (.exe, .dmg, etc.)
├── electron-builder.json  # Build configuration
└── package.json
```

## Distribution

After building, share these files:

- **Windows Installer**: `release/NEXOR-ERP-1.0.0-x64.exe`
- **Windows Portable**: `release/NEXOR-ERP-Portable-1.0.0.exe` (no install needed)
- **Mac**: `release/NEXOR-ERP-1.0.0-arm64.dmg`
- **Linux**: `release/NEXOR-ERP-1.0.0-x86_64.AppImage`

## Offline Mode

The desktop app works completely offline using localStorage. No internet or database required for basic operation.

For multi-computer setup with PostgreSQL, see `backend/README.md`.

## Troubleshooting

### "electron is not recognized"
Run `npm install` again to ensure Electron is installed.

### White screen on startup
Make sure you ran `npm run build` before `npm run electron:build`.

### App won't start
Check if port 5173 is available for dev mode, or if dist/index.html exists for production.
