# NEXOR ERP

> **O futuro é construído com nós** — *The future is built with us*

A premium, AGT-compliant ERP/POS for the Angolan market. Local-first Electron desktop app powered by PostgreSQL (Docker) with full SAF-T AO 1.01_01 compliance, multi-branch isolation, double-entry accounting, and real-time LAN sync.

---

## Highlights

- 🇦🇴 **AGT-Compliant** — SAF-T AO XML export, RSA-SHA256 invoice signing, QR codes, Original/Duplicado labels
- 💼 **Full ERP** — POS, Inventory (WAC), Purchases, Sales, Accounting, HR/Payroll, Production, Imports
- 🏬 **Multi-Branch** — Strict Sede/Filial isolation, inter-branch stock transfers, branch-scoped pricing
- 💱 **Multi-Currency** — Daily exchange rates (USD/EUR/ZAR → AOA), gain/loss tracking
- 🖨️ **Hardware** — 80mm/58mm thermal printers (USB/Serial), barcode scanners, shelf labels
- 🔄 **Real-Time Sync** — WebSockets on LAN port 4546 across all clients
- 🧩 **Single Transaction Engine** — Stock → WAC → Journals → Clearing → Links → Balances (atomic)

## Tech Stack

- **Frontend:** React 18 · Vite · TypeScript · Tailwind · shadcn/ui
- **Desktop:** Electron 41 (HashRouter, file:// loading)
- **Backend:** Node.js + Express + Socket.io · PostgreSQL 16 (Docker)
- **Build:** electron-builder (NSIS installer + portable .exe)

## Quick Start (Development)

```sh
git clone <repo>
npm install
docker-compose up -d            # Start PostgreSQL
cd backend && npm install && node src/migrations/run.js && npm start
cd .. && npm run electron:dev   # Launch Electron + Vite dev server
```

## Build Installer (Windows)

```sh
build-installer.bat
```

Outputs: `release/NEXOR-ERP-<version>-x64.exe` (NSIS) + `release/NEXOR-ERP-Portable-<version>.exe`

## Documentation

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — **One database per site**, releases, backups (Phase A)
- [`DESKTOP-APP.md`](./DESKTOP-APP.md) — Desktop packaging
- [`DOCKER-SETUP.md`](./DOCKER-SETUP.md) — Database setup
- [`backend/README.md`](./backend/README.md) — Backend server

## License

Copyright © 2026 NEXOR ERP. All rights reserved.
