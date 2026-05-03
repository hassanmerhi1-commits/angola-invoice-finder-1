const Database = require('better-sqlite3');

const DB_PATH = 'C:\\nexor\\erp.db';
const db = new Database(DB_PATH);

try {
  const row = db.prepare('SELECT COUNT(*) as count FROM products').get();
  console.log(`COUNT=${row.count}; DB_PATH=${DB_PATH}`);
  const sample = db.prepare('SELECT * FROM products LIMIT 5').all();
  console.log('SAMPLE_ROWS=', sample.length);
} catch (e) {
  console.error(`ERROR=${e.message}; DB_PATH=${DB_PATH}`);
  process.exitCode = 1;
}
