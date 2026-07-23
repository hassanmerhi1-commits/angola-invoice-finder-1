const { loadOrCreateJwtSecret } = require('./lib/nexorSecrets');

const { value: JWT_SECRET, persistent: JWT_SECRET_PERSISTENT } = loadOrCreateJwtSecret();

if (!JWT_SECRET_PERSISTENT && !process.env.JWT_SECRET) {
  console.warn(
    '[AUTH] JWT_SECRET not set — tokens invalidate when the backend restarts. '
    + 'Set JWT_SECRET in database.env or allow jwt.secret under NEXOR data/secrets.',
  );
}

module.exports = { JWT_SECRET, JWT_SECRET_PERSISTENT };
