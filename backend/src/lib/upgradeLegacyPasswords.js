const { ensureAuthUsersReady } = require('./ensureAuthUsersReady');

/** @deprecated Use ensureAuthUsersReady — kept for server startup hook name. */
async function upgradeLegacyPasswordHashesOnStartup() {
  await ensureAuthUsersReady();
}

module.exports = { upgradeLegacyPasswordHashesOnStartup };
