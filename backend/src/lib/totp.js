/**
 * Minimal TOTP (RFC 6238) using Node crypto — no extra npm deps.
 */
const crypto = require('crypto');

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += BASE32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(input) {
  const s = String(input || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const c of s) {
    const idx = BASE32.indexOf(c);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function hotp(secretBase32, counter) {
  const key = base32Decode(secretBase32);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24)
    | ((hmac[offset + 1] & 0xff) << 16)
    | ((hmac[offset + 2] & 0xff) << 8)
    | (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

function totp(secretBase32, atMs = Date.now(), stepSec = 30) {
  const counter = Math.floor(atMs / 1000 / stepSec);
  return hotp(secretBase32, counter);
}

function verifyTotp(secretBase32, code, { window = 1, stepSec = 30 } = {}) {
  const expected = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(expected)) return false;
  const now = Date.now();
  for (let w = -window; w <= window; w += 1) {
    const at = now + w * stepSec * 1000;
    if (totp(secretBase32, at, stepSec) === expected) return true;
  }
  return false;
}

function otpauthUrl({ secret, accountName, issuer = 'NEXOR ERP' }) {
  const label = encodeURIComponent(`${issuer}:${accountName}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(crypto.randomBytes(4).toString('hex'));
  }
  return codes;
}

module.exports = {
  generateSecret,
  totp,
  verifyTotp,
  otpauthUrl,
  generateBackupCodes,
};
