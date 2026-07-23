# NEXOR ERP — Rebuild & Deploy Checklist

Use this when rolling out a new build to the **server PC** and **LAN client PCs**.

Fill in your site values once (section 0), then follow the steps in order.

---

## 0. Site configuration (fill in)

| Item | Your value | Example |
|------|------------|---------|
| App version after build | ______________ | `1.0.40` |
| Server PC name | ______________ | `BELAS-SERVER` |
| Server LAN IP | ______________ | `192.168.10.18` |
| API port (usually 3000) | ______________ | `3000` |
| Server `IP` file content | path to `.db` | `C:\NEXOR ERP\data\belas.db` |
| Client `IP` file content | server IP only | `192.168.10.18` |
| Hot Update URL (clients) | `http://IP:PORT` | `http://192.168.10.18:3000` |

**Paths (do not delete on upgrade)**

| Path | Purpose |
|------|---------|
| `C:\Program Files\NEXOR ERP\` | Application binaries (replaced on install) |
| `C:\NEXOR ERP\IP` | Server vs client mode |
| `C:\NEXOR ERP\data\` | SQLite database (server only) |
| `%APPDATA%\NEXOR ERP\logs\` | Backend logs if something fails |

---

## 0b. Remote customer laptops (GitHub auto-update)

For PCs **not on your LAN** (e.g. a customer test laptop): install once, then publish new versions via GitHub Releases. The app checks for updates on startup and prompts the user to download/install.

**Full steps:** [RELEASE.md](./RELEASE.md) — bump `package.json` version → `git tag vX.Y.Z` → push tag → verify on test laptop.

Hot Update (§4 below) is for LAN only; **GitHub auto-update** is for internet-connected customers.

---

## 1. When do you need a full rebuild?

| You changed | Server | Clients |
|-------------|--------|---------|
| React UI only (`src/`) | Optional: [§4 Hot Update](#4-optional-ui-only-update-hot-update) | Hot Update reload, or skip if UI loads from server |
| Backend (`backend/`) | Restart app; full reinstall if packaged backend changed | Usually no reinstall |
| Electron (`electron/`) | **Full rebuild + reinstall** | **Full rebuild + reinstall** |
| Frontend + Electron | **Full rebuild + reinstall** | **Full rebuild + reinstall** |

---

## 2. Build on dev PC (once per release)

```powershell
cd c:\Users\user\source\repos\angola-invoice-finder-1
git pull
npm run electron:build
```

**Artifacts**

- Installer: `release\NEXOR-ERP-<version>-x64.exe`
- Unpacked: `release\win-unpacked\`

Copy the installer (or `win-unpacked` folder) to USB / network share for server and clients.

**Do not copy** `.tmp-*.db` files (local test databases; ignored by git).

---

## 3. Server PC deploy

### 3.1 Before install

- [ ] Close NEXOR ERP (Task Manager → end `NEXOR ERP.exe` if needed)
- [ ] Confirm `C:\NEXOR ERP\IP` contains the **database path** (e.g. `C:\NEXOR ERP\data\belas.db`)
- [ ] Do **not** delete `C:\NEXOR ERP\data\`

### 3.2 Install

**Option A — Installer (recommended)**

1. Run `NEXOR-ERP-<version>-x64.exe`
2. Install to `C:\Program Files\NEXOR ERP`
3. Accept SmartScreen if shown (unsigned build)

**Option B — Copy unpacked**

1. Open `C:\Program Files\NEXOR ERP\` as Administrator
2. Copy all files from `release\win-unpacked\` → overwrite when prompted

### 3.3 Verify server

- [ ] App starts (no white screen / `useTranslation` error)
- [ ] Login works
- [ ] Settings: server reachable (no “Cannot reach ERP server” on server itself)
- [ ] Dashboard / Products / Vendas load data
- [ ] Settings shows version **_______** (matches build)
- [ ] Optional: create a database backup in Settings

### 3.4 Firewall (if clients cannot connect)

On the **server** PC, run as Administrator:

```powershell
cd <repo>\scripts
.\allow-nexor-lan.ps1
```

Or ensure Windows Firewall allows **TCP 3000** (and **UDP 41234** for discovery).

**Sanity check from a client PC:**

```powershell
curl http://<SERVER_IP>:3000/api/health
```

Expect JSON with `"ok": true`.

---

## 4. Each client PC deploy

Repeat for **every** client machine.

### 4.1 Before install

- [ ] Close NEXOR ERP
- [ ] Confirm `C:\NEXOR ERP\IP` contains **server IP only** (not a `.db` path)
- [ ] Do **not** copy the server’s `IP` file onto clients

### 4.2 Install

- [ ] Same installer version as server (`NEXOR-ERP-<version>-x64.exe`)
- [ ] Or copy same `win-unpacked` build into `C:\Program Files\NEXOR ERP\`

### 4.3 Verify client

- [ ] App starts
- [ ] Login works
- [ ] Settings: “Cannot reach ERP server” is **gone**
- [ ] List backups works (optional)
- [ ] Download backup works (optional; large files safer on server)
- [ ] One business test: open Products or create/view a sale
- [ ] Version in Settings matches server: **_______**

### 4.4 Optional: Hot Update (one-time per client)

For **UI-only** updates later without reinstalling clients:

1. Settings → **Hot Update**
2. Enable → Server URL: `http://<SERVER_IP>:3000`
3. Test connection → **Apply Update Now**

---

## 5. Optional: UI-only update (Hot Update)

**On dev PC:**

```powershell
npm run build
.\deploy-webapp.ps1
```

**On server PC** — copy built UI into packaged webapp (if not using repo folder):

- Target: `C:\Program Files\NEXOR ERP\resources\backend\webapp\`
- Copy contents of `dist\*` there

**On clients** — Settings → Hot Update → **Apply Update Now** (or restart app).

Does **not** replace Electron or backend fixes — use [§2](#2-build-on-dev-pc-once-per-release) for those.

---

## 6. Go / no-go summary

| Check | Server | Client 1 | Client 2 | … |
|-------|--------|----------|----------|---|
| App opens | ☐ | ☐ | ☐ | |
| Login | ☐ | ☐ | ☐ | |
| Settings / server OK | ☐ | ☐ | ☐ | |
| Data / sales test | ☐ | ☐ | ☐ | |
| Same app version | ☐ | ☐ | ☐ | |

---

## 7. Common mistakes

1. **Mixed versions** — server updated, one client forgotten.
2. **Wrong `IP` file on client** — contains `.db` path → wrong mode / failures.
3. **Client `IP` includes `:3000`** — usually use IP only; app resolves port.
4. **Hot Update for Electron fixes** — only updates UI from server, not `.exe`.
5. **Deleting `C:\NEXOR ERP\`** — loses config and (on server) data path.

---

## 8. Troubleshooting

| Symptom | What to check |
|---------|----------------|
| “Failed to connect to server” | Server app running; firewall; `IP` file on client; `curl` health |
| “Cannot reach ERP server” in Settings | Same build deployed; server IP correct |
| Login works, no data | Wrong branch; user permissions; server DB path in `IP` |
| Backend won’t start on server | Logs: `%APPDATA%\NEXOR ERP\logs\backend-*.log` |

---

## Quick reference commands

```powershell
# Build installer
npm run electron:build

# UI-only deploy to backend/webapp (dev repo)
.\deploy-webapp.ps1

# Firewall helper (server)
.\scripts\allow-nexor-lan.ps1
```

---

## 9. Go-live money-path & security gates

- [ ] Admin password changed (no `changeme` / `caixa1` left active)
- [ ] `/api/health` shows schema up to date and matching app version
- [ ] Backup create + restore drill on a **copy** database
- [ ] Offsite folder set if possible (`BACKUP_OFFSITE_DIR`) — see Admin → Backup RTO hint
- [ ] Cash / card / transfer / credit sale verified
- [ ] Purchase invoice → stock → WAC → balanced journal
- [ ] Cashier cannot backdate (`backdate_post` denied)
- [ ] AGT: production does **not** invent CUCE unless `AGT_SIMULATE=true` is intentional
- [ ] Period reopen / backdate SOP reviewed: [docs/PERIOD-REOPEN-BACKDATE-SOP.md](./docs/PERIOD-REOPEN-BACKDATE-SOP.md)

See also: [DESKTOP-APP.md](./DESKTOP-APP.md), [backend/README.md](./backend/README.md), [RELEASE.md](./RELEASE.md).
