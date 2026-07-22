/**
 * Run work inside a PostgreSQL savepoint so failures do not abort the outer transaction.
 */

function sanitizeSavepointName(name) {
  return `sp_${String(name || 'work')}`.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 60);
}

async function runInSavepoint(client, name, fn) {
  const sp = sanitizeSavepointName(name);
  await client.query(`SAVEPOINT ${sp}`);
  try {
    const result = await fn();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    throw error;
  }
}

async function runOptionalInSavepoint(client, name, fn, onError) {
  try {
    return await runInSavepoint(client, name, fn);
  } catch (error) {
    if (onError) onError(error);
    return undefined;
  }
}

module.exports = {
  runInSavepoint,
  runOptionalInSavepoint,
};
