/** Wrap WHERE and AND a branch predicate so OR search terms cannot bypass the lock. */
function scopedSql(sqls, bid, clause) {
  if (!bid) return sqls;
  return sqls.map((sql) => {
    const text = String(sql);
    if (!/\sWHERE\s/i.test(text) || !/\sORDER BY/i.test(text)) return text;
    return text
      .replace(/\s+WHERE\s+/i, ' WHERE (')
      .replace(/\s+ORDER BY/i, `) ${clause} ORDER BY`);
  });
}

module.exports = { scopedSql };
