/**
 * Periodic job queue processor.
 * Env: JOB_QUEUE_MS (default 15000). Set 0 to disable.
 */
const { processDueJobs } = require('../lib/jobQueue');

/** Extend with job_type handlers as needed. */
const JOB_HANDLERS = {};

let timer = null;

function registerJobHandler(jobType, handler) {
  JOB_HANDLERS[jobType] = handler;
}

function startJobQueueWorker(intervalMs = Number(process.env.JOB_QUEUE_MS || 15000)) {
  if (timer) return;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    console.log('[JOB_QUEUE] Worker disabled');
    return;
  }
  const run = async () => {
    try {
      const n = await processDueJobs(JOB_HANDLERS);
      if (n > 0) console.log(`[JOB_QUEUE] Completed jobs: ${n}`);
    } catch (e) {
      console.warn('[JOB_QUEUE] process error:', e.message);
    }
  };
  setTimeout(run, 25_000);
  timer = setInterval(run, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  console.log(`[JOB_QUEUE] Worker every ${Math.round(intervalMs / 1000)}s`);
}

module.exports = { startJobQueueWorker, registerJobHandler, JOB_HANDLERS };
