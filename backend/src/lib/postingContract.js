/**
 * Journal shapes for money and stock.
 * A document and its journal use the same amounts. The lines must balance.
 * Parent documents (sale, purchase, transfer) already write their own journal,
 * so a stock row with those references must not write a second one.
 */

const ACCOUNTS = {
  OTHER_INCOME: '638',
  REVALUATION_RESERVE: '561',
  PURCHASES_MERCHANDISE: '212',
  INVENTORY_STOCK: '261',
  FREIGHT_ON_PURCHASES: '752',
  INVENTORY_SHRINKAGE: '758',
};

const PARENT_STOCK_REFERENCES = new Set([
  'purchase',
  'sale',
  'transfer',
  'transfer_in',
  'transfer_out',
  'credit_note',
  'opening',
]);

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function journalTotals(lines) {
  const debit = roundMoney((lines || []).reduce((sum, line) => sum + (Number(line.debit) || 0), 0));
  const credit = roundMoney((lines || []).reduce((sum, line) => sum + (Number(line.credit) || 0), 0));
  return { debit, credit, balanced: Math.abs(debit - credit) < 0.01 && debit > 0 };
}

function standaloneStockNeedsJournal(referenceType) {
  const ref = String(referenceType || '').trim().toLowerCase();
  return !PARENT_STOCK_REFERENCES.has(ref);
}

function buildPaymentJournalLines({ paymentType, amount, cashAccountCode, entityAccountCode, paymentNumber, entityName }) {
  const paymentAmount = roundMoney(amount);
  if (!(paymentAmount > 0)) return [];
  if (paymentType === 'receipt') {
    return [
      { accountCode: cashAccountCode, description: `Recebimento ${paymentNumber}`, debit: paymentAmount, credit: 0 },
      { accountCode: entityAccountCode, description: entityName, debit: 0, credit: paymentAmount },
    ];
  }
  return [
    { accountCode: entityAccountCode, description: entityName, debit: paymentAmount, credit: 0 },
    { accountCode: cashAccountCode, description: `Pagamento ${paymentNumber}`, debit: 0, credit: paymentAmount },
  ];
}

function buildStockAdjustmentJournalLines(direction, referenceType, totalValue, docLabel, freightOpts = {}) {
  const amount = roundMoney(totalValue);
  if (amount <= 0) return [];

  const ref = String(referenceType || '').toLowerCase();
  const landingCosts = roundMoney(freightOpts.landingCosts);
  const freightSourceAccount = String(freightOpts.freightSourceAccount || '').trim();
  const freightSourceName = String(freightOpts.freightSourceName || '').trim() || 'Pagamento frete';
  const supplierAccountCode = String(freightOpts.supplierAccountCode || '').trim();
  const splitFreight = landingCosts > 0 && freightSourceAccount.length > 0;
  const merchandiseValue = splitFreight
    ? Math.max(roundMoney(amount - landingCosts), 0)
    : amount;

  if (direction === 'IN') {
    let creditAccount = ACCOUNTS.OTHER_INCOME;
    let creditDesc = 'Contrapartida entrada inventário';

    if (ref === 'initial') {
      creditAccount = ACCOUNTS.REVALUATION_RESERVE;
      creditDesc = 'Existências iniciais';
    } else if (ref === 'purchase') {
      if (!/^321\d+$/i.test(supplierAccountCode)) {
        throw new Error('Stock purchase journal requires a supplier leaf account (321xxxxx)');
      }
      creditAccount = supplierAccountCode;
      creditDesc = 'Fornecedores (entrada directa — preferir FC)';
    } else if (ref === 'transfer' || ref === 'transfer_in') {
      return [
        { accountCode: ACCOUNTS.INVENTORY_STOCK, description: `Entrada ${docLabel}`, debit: amount, credit: 0 },
        { accountCode: ACCOUNTS.INVENTORY_STOCK, description: `Saída interna ${docLabel}`, debit: 0, credit: amount },
      ];
    } else if (ref === 'correction') {
      creditDesc = 'Correção inventário';
    }

    const lines = [];
    if (merchandiseValue > 0) {
      lines.push(
        { accountCode: ACCOUNTS.PURCHASES_MERCHANDISE, description: `Entrada mercadorias ${docLabel}`, debit: merchandiseValue, credit: 0 },
        { accountCode: creditAccount, description: creditDesc, debit: 0, credit: merchandiseValue },
      );
    }
    if (splitFreight) {
      lines.push(
        { accountCode: ACCOUNTS.FREIGHT_ON_PURCHASES, description: `Frete / transporte ${docLabel}`, debit: landingCosts, credit: 0 },
        { accountCode: freightSourceAccount, description: `${freightSourceName} — frete ${docLabel}`, debit: 0, credit: landingCosts },
      );
    }
    if (lines.length > 0) return lines;

    return [
      { accountCode: ACCOUNTS.PURCHASES_MERCHANDISE, description: `Entrada mercadorias ${docLabel}`, debit: amount, credit: 0 },
      { accountCode: creditAccount, description: creditDesc, debit: 0, credit: amount },
    ];
  }

  let expenseDesc = 'Saída inventário';
  if (ref === 'damage' || ref === 'expired' || ref === 'loss') {
    expenseDesc = 'Perdas / avarias inventário';
  } else if (ref === 'internal_use') {
    expenseDesc = 'Uso interno';
  } else if (ref === 'sample') {
    expenseDesc = 'Amostras';
  } else if (ref === 'donation') {
    expenseDesc = 'Donativos';
  }

  return [
    { accountCode: ACCOUNTS.INVENTORY_SHRINKAGE, description: `${expenseDesc} ${docLabel}`, debit: amount, credit: 0 },
    { accountCode: ACCOUNTS.PURCHASES_MERCHANDISE, description: `Saída mercadorias ${docLabel}`, debit: 0, credit: amount },
  ];
}

module.exports = {
  ACCOUNTS,
  PARENT_STOCK_REFERENCES,
  roundMoney,
  journalTotals,
  standaloneStockNeedsJournal,
  buildPaymentJournalLines,
  buildStockAdjustmentJournalLines,
};
