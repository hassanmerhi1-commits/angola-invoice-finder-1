const { signFiscalEntity } = require('./fiscalSigning');

const TABLE_ENTITY = {
  credit_notes: 'credit_note',
  debit_notes: 'debit_note',
  transport_documents: 'transport_document',
};

async function signFiscalDocument(tableName, documentId, _numberColumn, _hashColumn, options = {}) {
  const entityType = TABLE_ENTITY[tableName];
  if (!entityType) {
    throw new Error(`Unsupported fiscal document table: ${tableName}`);
  }
  return signFiscalEntity(entityType, documentId, options);
}

module.exports = { signFiscalDocument };
