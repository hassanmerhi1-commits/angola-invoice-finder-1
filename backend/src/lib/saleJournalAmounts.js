/**
 * Sale header amounts for journals / SAF-T / AGT.
 *
 * POS sends a NET header subtotal (discount already in the lines).
 * The sales-invoice form sends a GROSS header subtotal plus a separate discount.
 * Customer/cash is always `total`. Revenue credit must be `total − IVA` so the
 * journal balances and fiscal netTotal matches what was charged.
 */
function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function resolveSaleJournalAmounts({ subtotal, taxAmount, discount, total } = {}) {
  const totalNum = roundMoney(total);
  const taxNum = roundMoney(taxAmount || 0);
  const discountNum = Math.max(0, roundMoney(discount || 0));
  const rawSub = roundMoney(subtotal || 0);
  const netFromTotal = roundMoney(totalNum - taxNum);
  const netSales = netFromTotal >= 0 ? netFromTotal : 0;
  const headerWasGross =
    discountNum > 0.005
    && Math.abs(roundMoney(rawSub - discountNum) - netSales) < 0.02
    && Math.abs(rawSub - netSales) > 0.02;

  return {
    total: totalNum,
    tax: taxNum,
    discount: discountNum,
    netSales,
    headerWasGross,
  };
}

module.exports = {
  roundMoney,
  resolveSaleJournalAmounts,
};
