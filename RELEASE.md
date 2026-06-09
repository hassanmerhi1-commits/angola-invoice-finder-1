# NEXOR ERP — GitHub auto-update releases

Use this guide to publish a new desktop build and verify that customer laptops update themselves from **GitHub Releases** (no LAN, no USB after the first install).

Related docs: [DEPLOY-CHECKLIST.md](./DEPLOY-CHECKLIST.md) (server + LAN clients), [DEPLOYMENT.md](./DEPLOYMENT.md) (database per site).

---

## How it works

1. Customer installs NEXOR ERP **once** (`NEXOR-ERP-x.x.x-x64.exe`).
2. On startup (production builds only), the app checks GitHub for a newer version.
3. If a release exists, the user gets a toast: **Download** or **Later**.
4. After download: **Install & restart** (or install on quit).
5. `electron-updater` reads `latest.yml` from the GitHub Release — that file **must** be uploaded with the installer.

Configured in `electron-builder.json`:

- **Owner:** `hassanmerhi1-commits`
- **Repo:** `angola-invoice-finder-1`
- **Current app version:** see `package.json` → `version` (e.g. `1.0.51`)

CI workflow: `.github/workflows/build-and-release.yml` (runs on tags `v*`).

---

## Prerequisites

| Requirement | Why |
|-------------|-----|
| GitHub repo **public**, or private + read token in the app | `electron-updater` downloads release assets from GitHub |
| GitHub Actions enabled | Builds the `.exe` and uploads assets |
| Version bumped in `package.json` | Must be **higher** than what customers have |
| Tag matches version | Tag `v1.0.50` ↔ version `1.0.50` |
| Internet on customer laptop | Updates do not use LAN |

**Server vs client laptops**

| Machine | What auto-update changes |
|---------|--------------------------|
| **Server PC** (PostgreSQL + embedded backend) | Full app **including backend** |
| **LAN client PC** | Desktop shell only — API/data still come from the **server** |

Backend-only fixes must be deployed on the **server** (see `scripts/sync-nexor-backend.ps1`) even if clients auto-update.

---

## Publish a release (your workflow)

### 1. Finish changes in Cursor

```powershell
cd c:\Users\user\source\repos\angola-invoice-finder-1
git status
```

### 2. Bump version

Edit `package.json` — increment `version` (semver), e.g. `1.0.49` → `1.0.50`.

### 3. Commit and push

```powershell
git add -A
git commit -m "chore: release 1.0.50"
git push origin main
```

Use your actual branch name if not `main`.

### 4. Tag and push (triggers CI)

```powershell
git tag v1.0.50
git push origin v1.0.50
```

### 5. Wait for GitHub Actions

1. Open: `https://github.com/hassanmerhi1-commits/angola-invoice-finder-1/actions`
2. Workflow **Build and Release** should run for tag `v1.0.50`.
3. When green, open **Releases** and confirm assets:

   - `NEXOR-ERP-1.0.50-x64.exe` (or similar)
   - `latest.yml` ← **required** for update detection
   - Optional: portable `.exe`

If `latest.yml` is missing, auto-update will not find the new version.

### 6. Optional — build locally (without CI)

```powershell
npm run electron:build
```

Artifacts land in `release/`. To publish manually:

1. Create a GitHub Release for tag `v1.0.50`.
2. Upload **both** `release/NEXOR-ERP-1.0.50-x64.exe` and `release/latest.yml`.

---

## Test auto-update (step by step)

Goal: prove Laptop B (or any test PC) can go from **older** → **newer** without you visiting it.

### Phase A — Install the “old” version

**Option 1 — From an existing GitHub Release**

1. Download the previous release installer (e.g. `1.0.49`) from GitHub Releases.
2. Install on the test laptop.
3. Open **Settings** → confirm **Version** shows `1.0.49`.

**Option 2 — Build old version locally**

```powershell
# Temporarily set version to 1.0.49 in package.json, then:
npm run electron:build
# Install release\NEXOR-ERP-1.0.49-x64.exe on test laptop
# Restore package.json to 1.0.50 before publishing
```

### Phase B — Publish the “new” version

1. Set `package.json` version to `1.0.50`.
2. Commit, tag `v1.0.50`, push tag (see [Publish a release](#publish-a-release-your-workflow)).
3. Wait until the GitHub Release contains `latest.yml` + new `.exe`.

### Phase C — Verify on the test laptop

1. **Internet connected** (Wi‑Fi or mobile hotspot — LAN not required).
2. Close NEXOR ERP completely (Task Manager → end `NEXOR ERP` if needed).
3. Start NEXOR ERP again.
4. Within ~10 seconds you should see a toast: **Update available** (v1.0.50).
5. Or open **Settings** → **Check for updates** → status **Update Available**.
6. Click **Download** → wait for **Ready to Install**.
7. Click **Install & restart**.
8. After restart: **Settings** → Version = `1.0.50`.

### Phase D — Pass / fail

| Check | Pass |
|-------|------|
| Toast or Settings shows update available | ☐ |
| Download completes | ☐ |
| Install & restart works | ☐ |
| Version matches new release | ☐ |
| App opens and login works | ☐ |

---

## What the customer sees

- **Startup:** automatic check (~3 s after app opens).
- **Toast:** “Update available” with **Download** / **Later**.
- **Settings:** Application Information + manual **Check for updates** / **Download** / **Install**.

Updates are **not** fully silent: the user must confirm download (`autoDownload = false` in `electron/main.cjs`).

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| “Up to date” but you published a new release | Customer version already ≥ release; or `latest.yml` missing; or tag/version mismatch |
| “Update check failed” | No internet; repo private without token; wrong `publish` owner/repo in `electron-builder.json` |
| Update downloads but install blocked | Run installer as user with admin rights; accept SmartScreen (unsigned build) |
| UI updated but bug still on server | Server PC not updated — deploy backend or install new build on **server** |
| Works in dev, not in installed app | Dev mode skips update checks (`ELECTRON_DEV` / `NODE_ENV=development`) |
| GitHub Action failed | Open Actions log; common: `npm install` / native rebuild errors |

### Verify release assets manually

```powershell
# Replace VERSION with the new tag, e.g. 1.0.50
curl -sL "https://github.com/hassanmerhi1-commits/angola-invoice-finder-1/releases/latest/download/latest.yml"
```

You should see YAML with `version: 1.0.50` and a path to the `.exe`.

### Logs on the customer PC

```
%APPDATA%\NEXOR ERP\logs\backend-*.log
```

Main-process updater messages also appear in the terminal if you launch from a shortcut with logging enabled.

---

## Quick reference

```powershell
# Full release (after bumping package.json)
git add package.json
git commit -m "chore: release 1.0.50"
git push
git tag v1.0.50
git push origin v1.0.50

# Local build only (no publish)
npm run electron:build
```

**First customer install:** send them the latest `NEXOR-ERP-x.x.x-x64.exe` from GitHub Releases.  
**Every later update:** publish a new tag; their app picks it up over the internet.
