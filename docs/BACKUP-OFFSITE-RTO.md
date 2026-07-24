# Offsite backup + restore RTO

## Goal

Survive disk or server loss with a documented restore time under **1 hour**.

## Configure offsite copy

Set `BACKUP_OFFSITE_DIR` on the API host so every backup (manual or `AUTO_BACKUP`) is also copied off the DB volume.

### Docker Compose example

1. Create a host folder, e.g. `D:\NEXOR-backups-offsite`
2. Mount it and set the env var:

```yaml
environment:
  BACKUP_DIR: /app/backups
  BACKUP_OFFSITE_DIR: /app/backups-offsite
  AUTO_BACKUP: "1"
  AUTO_BACKUP_INTERVAL_HOURS: "24"
  AUTO_BACKUP_KEEP: "14"
volumes:
  - nexor_backups:/app/backups
  - D:/NEXOR-backups-offsite:/app/backups-offsite
```

3. Rebuild/restart backend, then open **Settings → Database backup**.
   - UI should show offsite configured.
   - Create a backup and confirm a second file appears in the offsite folder.

### Without Compose

Set `BACKUP_OFFSITE_DIR` to any writable path (USB, NAS share, second disk) in the process environment before starting the backend.

## Weekly check (ops)

Once a week:

1. Confirm newest file in offsite folder is less than 8 days old.
2. Optionally copy the latest dump to a third location (cloud drive / another PC).

```powershell
# From repo root on the server
.\scripts\verify-offsite-backup.ps1 -OffsiteDir 'D:\NEXOR-backups-offsite' -MaxAgeDays 8
```

## Restore drill (copy DB only)

Never restore over production without a snapshot.

1. Stop clients / stop API writes.
2. Restore the latest dump into a **copy** database (or staging compose project).
3. Point a test backend at the copy, start it, check `/api/health` (`ok`, schema up to date).
4. Spot-check: login, one sale list, one journal, one product stock.
5. Record actual minutes taken — target RTO **under 60 minutes**.

## Related

- Admin UI RTO hint: Settings → Database backup
- Go-live gates: `DEPLOY-CHECKLIST.md` §9
- Health gate: `scripts/verify-server-health.ps1`
- Watchdog: `scripts/watchdog-health.ps1`
