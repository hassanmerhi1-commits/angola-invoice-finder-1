const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.JWT_SECRET) {
  console.warn('[AUTH] JWT_SECRET not set. Using ephemeral secret for this process.');
}

module.exports = { JWT_SECRET };
