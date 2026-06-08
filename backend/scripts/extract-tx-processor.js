const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '../src/routes/transactions.js');
const outPath = path.join(__dirname, '../src/transactionProcessor.js');
const lines = fs.readFileSync(srcPath, 'utf8').split(/\r?\n/);

const header = `const db = require('./db');
const { randomUUID } = require('crypto');
const {
  recordStockMovement,
  resolveStockEntryDirection,
  createOpenItem,
  reduceSupplierInvoiceOpenItem,
  adoptPurchaseOrderOpenItemForInvoice,
  syncSupplierBalanceFromOpenItems,
  isOpenItemDebitFlag,
  linkDocuments,
  validatePeriod,
  auditLog,
  applyPurchaseSupplierToProducts,
} = require('./transactionEngine');
const { isUniqueSkuBranchError } = require('./lib/productSkuResolve');
const {
  createJournalEntry,
} = require('./accounting');

`;

const helpers = lines.slice(72, 185).join('\n');
let body = lines.slice(402, 826).join('\n');
body = body.replace(/req\.body/g, 'body');
body = body.replace(
  /await client\.query\('COMMIT'\);\s*\n\s*const skipped = \{/,
  'const skipped = {'
);
body = body.replace(
  /return res\.status\(200\)\.json\(skipped\);/,
  'return skipped;'
);
body = body.replace(
  /await client\.query\('COMMIT'\);\s*\n\s*result\.success = true;/,
  'result.success = true;'
);
body = body.replace(
  /if \(transactionType === 'purchase_invoice' && documentId\) \{[\s\S]*?\}\s*\n\s*await broadcastTable[\s\S]*?res\.status\(201\)\.json\(result\);/,
  'return result;'
);

const content = `${header}${helpers}

async function processTransactionBody(client, body) {
${body}
}

module.exports = { processTransactionBody, isUniqueSkuBranchError };
`;

fs.writeFileSync(outPath, content);
console.log('Wrote', outPath, content.length, 'bytes');
