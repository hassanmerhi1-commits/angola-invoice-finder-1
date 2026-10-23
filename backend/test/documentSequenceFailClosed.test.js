/**
 * Fiscal numbering must fail closed — never invent a timestamp document number.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const accounting = require(path.join(__dirname, '../src/accounting'));

test('refuses to invent a timestamp number when document_sequences fails', async () => {
  const brokenClient = {
    async query() {
      throw new Error('document_sequences relation does not exist');
    },
  };
  await assert.rejects(
    () => accounting.generateSequenceNumber(
      brokenClient,
      'sales_invoice',
      'FT',
      { branchId: 'branch-sede', branchCode: 'SEDE' },
    ),
    (err) => {
      assert.equal(err.code, 'DOCUMENT_SEQUENCE_UNAVAILABLE');
      assert.match(String(err.message), /sequência fiscal não está disponível/i);
      assert.doesNotMatch(String(err.message), /FT\d{8}/);
      return true;
    },
  );
});

test('peek also refuses a fake preview number when sequences fail', async () => {
  const brokenClient = {
    async query() {
      throw new Error('document_sequences relation does not exist');
    },
  };
  await assert.rejects(
    () => accounting.peekSequenceNumber(
      brokenClient,
      'sales_invoice',
      'FT',
      { branchId: 'branch-sede', branchCode: 'SEDE' },
    ),
    (err) => {
      assert.equal(err.code, 'DOCUMENT_SEQUENCE_UNAVAILABLE');
      return true;
    },
  );
});
