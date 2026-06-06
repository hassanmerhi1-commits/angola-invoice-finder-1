const db = require('../db');
const { openItemIsDebitSql } = require('./sqlDialect');

/** @deprecated Prefer openItemIsDebitSql(db) — PG cannot compare boolean to integer. */
const OPEN_ITEM_IS_DEBIT_SQL = openItemIsDebitSql(db);

module.exports = {
  OPEN_ITEM_IS_DEBIT_SQL,
  openItemIsDebitSql,
};
