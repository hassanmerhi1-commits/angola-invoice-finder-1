const crypto = require('crypto');
const db = require('../db');

/**
 * @param {string} type
 * @param {object|string} payload
 * @param {{ runAfter?: Date|string }} [opts]
 */
async function enqueueJob(type, payload, { runAfter } = {}) {
  const id = crypto.randomUUID();
  const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload ?? {});
  const runAfterVal = runAfter ? new Date(runAfter).toISOString() : new Date().toISOString();
  await db.query(
    `INSERT INTO job_queue (id, job_type, payload, status, run_after)
     VALUES ($1, $2, $3, 'pending', $4)`,
    [id, type, payloadStr, runAfterVal],
  );
  return id;
}

/**
 * @param {Record<string, (payload: object, job: object) => Promise<void>>} handlerMap
 * @param {number} [limit]
 */
async function processDueJobs(handlerMap, limit = 10) {
  const now = new Date().toISOString();
  const r = await db.query(
    `SELECT * FROM job_queue
     WHERE status = 'pending' AND run_after <= $1
     ORDER BY run_after ASC
     LIMIT $2`,
    [now, limit],
  );

  let processed = 0;
  for (const job of r.rows || []) {
    const handler = handlerMap[job.job_type];
    if (!handler) {
      await db.query(
        `UPDATE job_queue
         SET status = 'failed', last_error = $2, completed_at = CURRENT_TIMESTAMP, attempts = attempts + 1
         WHERE id = $1`,
        [job.id, `No handler for job_type ${job.job_type}`],
      );
      continue;
    }

    let payload = {};
    try {
      payload = typeof job.payload === 'string' ? JSON.parse(job.payload || '{}') : (job.payload || {});
    } catch {
      payload = {};
    }

    try {
      await handler(payload, job);
      await db.query(
        `UPDATE job_queue SET status = 'complete', completed_at = CURRENT_TIMESTAMP WHERE id = $1`,
        [job.id],
      );
      processed += 1;
    } catch (e) {
      const attempts = Number(job.attempts || 0) + 1;
      const maxAttempts = Number(job.max_attempts || 5);
      const err = String(e?.message || e || 'job failed');
      if (attempts >= maxAttempts) {
        await db.query(
          `UPDATE job_queue
           SET status = 'failed', attempts = $2, last_error = $3, completed_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [job.id, attempts, err],
        );
      } else {
        const retryAt = new Date(Date.now() + 60_000).toISOString();
        await db.query(
          `UPDATE job_queue SET attempts = $2, last_error = $3, run_after = $4 WHERE id = $1`,
          [job.id, attempts, err, retryAt],
        );
      }
    }
  }
  return processed;
}

module.exports = {
  enqueueJob,
  processDueJobs,
};
