/**
 * Wrap a pg client so the first real SQL error is kept when Postgres later
 * returns "current transaction is aborted…".
 */

function trackFirstSqlError(client) {
  let firstError = null;
  const originalQuery = client.query.bind(client);

  client.query = function trackedQuery(...args) {
    const result = originalQuery(...args);
    if (result && typeof result.then === 'function') {
      return result.catch((error) => {
        const msg = String(error?.message || error || '');
        if (!firstError && !/current transaction is aborted/i.test(msg)) {
          firstError = error;
          console.error('[SQL FIRST ERROR]', msg);
        }
        if (/current transaction is aborted/i.test(msg) && firstError) {
          const wrapped = new Error(
            `${firstError.message} [then: current transaction is aborted]`,
          );
          wrapped.cause = firstError;
          wrapped.code = firstError.code || error.code;
          throw wrapped;
        }
        throw error;
      });
    }
    return result;
  };

  client.getFirstSqlError = () => firstError;
  return client;
}

module.exports = { trackFirstSqlError };
