/**
 * Periodic webhook delivery worker.
 * Env: WEBHOOK_DELIVERY_MS (default 10000). Set 0 to disable.
 */
const { deliverPendingWebhooks } = require('../lib/webhooks');

let timer = null;

function startWebhookWorker(intervalMs = Number(process.env.WEBHOOK_DELIVERY_MS || 10000)) {
  if (timer) return;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    console.log('[WEBHOOKS] Delivery worker disabled');
    return;
  }
  const run = async () => {
    try {
      const n = await deliverPendingWebhooks();
      if (n > 0) console.log(`[WEBHOOKS] Delivered: ${n}`);
    } catch (e) {
      console.warn('[WEBHOOKS] delivery error:', e.message);
    }
  };
  setTimeout(run, 20_000);
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[WEBHOOKS] Delivery worker every ${Math.round(intervalMs / 1000)}s`);
}

module.exports = { startWebhookWorker };
