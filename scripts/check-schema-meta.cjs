const fs = require('fs');
const path = require('path');

function loadDatabaseEnv() {
  const candidates = [
    path.join(process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP', 'database.env'),
    path.join(__dirname, '..', 'database.env'),
    path.join(__dirname, '..', 'backend', '.env'),
  ];
  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) continue;
      process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    console.log('[check] env:', envPath);
    return;
  }
}

loadDatabaseEnv();

async function main() {
  const db = require(path.join(__dirname, '..', 'backend', 'src', 'db'));
  const { buildDeploymentStatus, recordAppMetaForDb, readAppVersion, EXPECTED_SCHEMA_VERSION } =
    require(path.join(__dirname, '..', 'backend', 'src', 'lib', 'deploymentStatus'));

  console.log('[check] engine:', db.engine);
  console.log('[check] sqlite path:', db.dbPath || '(n/a)');
  console.log('[check] expected schema:', EXPECTED_SCHEMA_VERSION);

  const before = await buildDeploymentStatus(db);
  console.log('[check] before:', before.schemaVersion, '/', before.schemaVersionExpected);

  await recordAppMetaForDb(db, readAppVersion());

  const after = await buildDeploymentStatus(db);
  console.log('[check] after:', after.schemaVersion, '/', after.schemaVersionExpected);

  if (db.engine === 'postgres') {
    const rows = await db.query('SELECT key, value FROM app_meta ORDER BY key');
    console.log('[check] app_meta:', rows.rows);
  } else if (db.sqlite) {
    try {
      const rows = db.sqlite.prepare('SELECT key, value FROM app_meta ORDER BY key').all();
      console.log('[check] app_meta:', rows);
    } catch (e) {
      console.log('[check] app_meta error:', e.message);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
