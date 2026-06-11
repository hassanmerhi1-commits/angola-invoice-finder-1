const { signFiscalEntity } = require('./fiscalSigning');

async function signSaleInvoice(saleId) {
  return signFiscalEntity('sale', saleId);
}

module.exports = { signSaleInvoice };
