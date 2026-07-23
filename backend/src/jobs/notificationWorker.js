/**
 * Periodic low-stock notification scan.
 * Env: NOTIFICATION_SCAN_MS (default 300000 = 5 min). Set 0 to disable.
 */
const { scanLowStockNotifications } = require('../lib/notifications');

let timer = null;

function startNotificationWorker(intervalMs = Number(process.env.NOTIFICATION_SCAN_MS || 300000)) {
  if (timer) return;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    console.log('[NOTIFICATIONS] Worker disabled');
    return;
  }
  const run = async () => {
    try {
      const n = await scanLowStockNotifications();
      if (n > 0) console.log(`[NOTIFICATIONS] Low-stock alerts created: ${n}`);
    } catch (e) {
      console.warn('[NOTIFICATIONS] scan error:', e.message);
    }
  };
  setTimeout(run, 45_000);
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[NOTIFICATIONS] Low-stock scan every ${Math.round(intervalMs / 1000)}s`);
}

module.exports = { startNotificationWorker };
