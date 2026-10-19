/**
 * Pure password-hash checks (no SQLite / Electron ABI).
 */
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  verifyPassword,
  isBcryptHash,
  isBrokenBcryptHash,
  DUMMY_BCRYPT_HASH,
} = require('../src/lib/passwordAuth');

const REAL_CHANGEME_HASH = '$2a$12$b2O7uSmkdR5JljEgu.lQCeHGhRrgh5LO7v2yfML7QNOz808XjWo.y';
const REAL_CAIXA1_HASH = '$2a$12$DngiIU14Vp/RPbPbBTmQEuDjyi8kDStP2.UGjK/02jqzeXNGetOFu';
const LEGACY_CAIXA1_HASH = '$2a$12$6EUte9gkI6Rhiiq6d8C.qe.xOHVQKwz6y/PfVs/yZuft4CshAlAhi';
const PLACEHOLDER_HASH = '$2a$10$xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx';

describe('passwordAuth seed hashes', () => {
  it('accepts factory changeme/caixa1 hashes and flags the 001 placeholder as broken', async () => {
    assert.equal(isBcryptHash(DUMMY_BCRYPT_HASH), true);
    assert.equal(isBrokenBcryptHash(PLACEHOLDER_HASH), true);
    assert.equal(isBrokenBcryptHash(DUMMY_BCRYPT_HASH), false);
    assert.equal(isBrokenBcryptHash(REAL_CHANGEME_HASH), false);
    assert.equal(await verifyPassword('changeme', DUMMY_BCRYPT_HASH), true);
    assert.equal(await verifyPassword('changeme', REAL_CHANGEME_HASH), true);
    assert.equal(await verifyPassword('caixa1', LEGACY_CAIXA1_HASH), true);
    assert.equal(await verifyPassword('caixa1', REAL_CAIXA1_HASH), true);
    assert.equal(await verifyPassword('changeme', PLACEHOLDER_HASH), false);
    assert.equal(await verifyPassword('admin123', DUMMY_BCRYPT_HASH), false);
  });
});
