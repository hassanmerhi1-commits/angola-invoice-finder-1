/**
 * PostgreSQL backup/restore — local pg_dump/psql or Docker (kwanza-postgres).
 */
const { execFile, spawn } = require('child_process');
const fs = require('fs');

const DEFAULT_DOCKER_CONTAINER =
  process.env.PG_DOCKER_CONTAINER
  || process.env.NEXOR_PG_DOCKER_CONTAINER
  || 'kwanza-postgres';

function parsePgConnection() {
  const connStr = process.env.DATABASE_URL;
  if (connStr) {
    try {
      const url = new URL(connStr);
      return {
        host: url.hostname || '127.0.0.1',
        port: url.port || '5432',
        user: decodeURIComponent(url.username || 'postgres'),
        database: (url.pathname || '/kwanza_erp').replace(/^\//, '') || 'kwanza_erp',
        password: decodeURIComponent(url.password || ''),
      };
    } catch {
      /* fall through */
    }
  }
  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: process.env.PGPORT || '5432',
    user: process.env.PGUSER || 'postgres',
    database: process.env.PGDATABASE || 'kwanza_erp',
    password: process.env.PGPASSWORD || process.env.POSTGRES_PASSWORD || '',
  };
}

function pgEnv(conn) {
  const env = { ...process.env };
  if (conn.password) env.PGPASSWORD = conn.password;
  return env;
}

function execFileAsync(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        timeout: opts.timeout || 120000,
        maxBuffer: opts.maxBuffer || 512 * 1024 * 1024,
        env: opts.env || process.env,
      },
      (error, stdout, stderr) => {
        if (error) {
          const msg = String(stderr || error.message || '').trim();
          const err = new Error(msg || error.message);
          err.code = error.code;
          reject(err);
        } else {
          resolve(stdout);
        }
      },
    );
  });
}

async function isDockerContainerRunning(name) {
  try {
    const out = await execFileAsync('docker', ['inspect', '-f', '{{.State.Running}}', name], { timeout: 15000 });
    return String(out).trim() === 'true';
  } catch {
    return false;
  }
}

function isMissingBinaryError(err) {
  const code = err?.code;
  const msg = String(err?.message || '');
  return code === 'ENOENT' || /enoent/i.test(msg) || /not found/i.test(msg);
}

async function localPgDump(binary, filepath, conn) {
  const args = [
    '-h', conn.host,
    '-p', String(conn.port),
    '-U', conn.user,
    '-d', conn.database,
    '--format=plain',
    '--no-owner',
    '--no-acl',
    '-f', filepath,
  ];
  await execFileAsync(binary, args, { env: pgEnv(conn), timeout: 120000 });
}

async function dockerPgDump(filepath, conn) {
  const container = DEFAULT_DOCKER_CONTAINER;
  const args = [
    'exec',
    container,
    'pg_dump',
    '-U', conn.user,
    '-d', conn.database,
    '--format=plain',
    '--no-owner',
    '--no-acl',
  ];
  const stdout = await execFileAsync('docker', args, { timeout: 300000 });
  fs.writeFileSync(filepath, stdout, 'utf8');
  console.log(`[BACKUP] PostgreSQL dump via Docker (${container})`);
}

async function createPostgresBackup(filepath) {
  const conn = parsePgConnection();
  const candidates = [];
  const custom = String(process.env.PG_DUMP_PATH || '').trim();
  if (custom) candidates.push({ kind: 'local', bin: custom });
  candidates.push({ kind: 'local', bin: 'pg_dump' });
  if (await isDockerContainerRunning(DEFAULT_DOCKER_CONTAINER)) {
    candidates.push({ kind: 'docker' });
  }

  let lastErr;
  for (const c of candidates) {
    try {
      if (c.kind === 'docker') {
        await dockerPgDump(filepath, conn);
      } else {
        await localPgDump(c.bin, filepath, conn);
        console.log(`[BACKUP] PostgreSQL dump via ${c.bin}`);
      }
      if (!fs.existsSync(filepath) || fs.statSync(filepath).size < 50) {
        throw new Error('Backup file is empty or missing');
      }
      return;
    } catch (e) {
      lastErr = e;
      if (!isMissingBinaryError(e) && c.kind === 'local' && candidates.some((x) => x.kind === 'docker')) {
        console.warn(`[BACKUP] ${c.bin} failed (${e.message}) — trying Docker…`);
        continue;
      }
      if (c.kind === 'docker' || !candidates.some((x) => x.kind === 'docker')) {
        if (!isMissingBinaryError(e)) throw e;
      }
    }
  }

  throw lastErr || new Error(
    'pg_dump not found. Install PostgreSQL client tools, set PG_DUMP_PATH, or run Postgres in Docker (kwanza-postgres).',
  );
}

async function localPsqlRestore(filepath, conn) {
  const args = [
    '-h', conn.host,
    '-p', String(conn.port),
    '-U', conn.user,
    '-d', conn.database,
    '-f', filepath,
  ];
  await execFileAsync('psql', args, { env: pgEnv(conn), timeout: 300000 });
}

function dockerPsqlRestore(filepath, conn) {
  const container = DEFAULT_DOCKER_CONTAINER;
  const sql = fs.readFileSync(filepath, 'utf8');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['exec', '-i', container, 'psql', '-U', conn.user, '-d', conn.database],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let stderr = '';
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        console.log(`[BACKUP] PostgreSQL restore via Docker (${container})`);
        resolve();
      } else {
        reject(new Error(stderr.trim() || `psql exited with code ${code}`));
      }
    });
    child.stdin.write(sql);
    child.stdin.end();
  });
}

async function restorePostgresBackup(filepath) {
  const conn = parsePgConnection();
  try {
    await localPsqlRestore(filepath, conn);
    return;
  } catch (e) {
    if (!isMissingBinaryError(e) || !(await isDockerContainerRunning(DEFAULT_DOCKER_CONTAINER))) {
      throw e;
    }
  }
  await dockerPsqlRestore(filepath, conn);
}

module.exports = {
  createPostgresBackup,
  restorePostgresBackup,
  parsePgConnection,
  DEFAULT_DOCKER_CONTAINER,
};
