/**
 * PostgreSQL backup/restore — local pg_dump/psql or Docker (kwanza-postgres).
 */
const { execFile, spawn } = require('child_process');
const fs = require('fs');

const DEFAULT_DOCKER_CONTAINER =
  process.env.PG_DOCKER_CONTAINER
  || process.env.NEXOR_PG_DOCKER_CONTAINER
  || 'kwanza-postgres';

function runningInsideDocker() {
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

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
  if (runningInsideDocker()) return false;
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

function isVersionMismatchError(err) {
  const msg = String(err?.message || '');
  return /version mismatch/i.test(msg) || /server version:/i.test(msg);
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
  await execFileAsync(binary, args, { env: pgEnv(conn), timeout: 300000 });
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

async function buildBackupCandidates() {
  const candidates = [];
  const custom = String(process.env.PG_DUMP_PATH || '').trim();
  if (custom) candidates.push({ kind: 'local', bin: custom });

  // Host machine: prefer docker exec into kwanza-postgres (no local pg_dump install needed).
  if (await isDockerContainerRunning(DEFAULT_DOCKER_CONTAINER)) {
    candidates.push({ kind: 'docker' });
  }

  candidates.push({ kind: 'local', bin: 'pg_dump' });
  return candidates;
}

async function createPostgresBackup(filepath) {
  const conn = parsePgConnection();
  const candidates = await buildBackupCandidates();
  let lastErr;

  for (let i = 0; i < candidates.length; i += 1) {
    const c = candidates[i];
    try {
      if (c.kind === 'docker') {
        await dockerPgDump(filepath, conn);
      } else {
        await localPgDump(c.bin, filepath, conn);
        console.log(`[BACKUP] PostgreSQL dump via ${c.bin} → ${conn.host}:${conn.port}/${conn.database}`);
      }
      if (!fs.existsSync(filepath) || fs.statSync(filepath).size < 50) {
        throw new Error('Backup file is empty or missing');
      }
      return;
    } catch (e) {
      lastErr = e;
      const label = c.kind === 'docker' ? 'docker' : c.bin;
      console.warn(`[BACKUP] ${label} failed (${i + 1}/${candidates.length}):`, e.message);
      if (i === candidates.length - 1) break;
      if (isMissingBinaryError(e) || isVersionMismatchError(e)) continue;
      // Connection/auth errors on local pg_dump — still try docker if available.
      if (c.kind === 'local' && candidates.some((x) => x.kind === 'docker')) continue;
      throw e;
    }
  }

  throw lastErr || new Error(
    'pg_dump not found. Install PostgreSQL client tools, set PG_DUMP_PATH, rebuild the backend Docker image (postgresql-client), or run Postgres in Docker (kwanza-postgres).',
  );
}

async function localPsqlRestore(filepath, conn) {
  const binary = String(process.env.PSQL_PATH || 'psql').trim() || 'psql';
  const args = [
    '-h', conn.host,
    '-p', String(conn.port),
    '-U', conn.user,
    '-d', conn.database,
    '-f', filepath,
  ];
  await execFileAsync(binary, args, { env: pgEnv(conn), timeout: 300000 });
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
  if (!runningInsideDocker() && await isDockerContainerRunning(DEFAULT_DOCKER_CONTAINER)) {
    try {
      await dockerPsqlRestore(filepath, conn);
      return;
    } catch (e) {
      if (!isMissingBinaryError(e)) {
        console.warn('[BACKUP] Docker restore failed, trying local psql:', e.message);
      }
    }
  }
  try {
    await localPsqlRestore(filepath, conn);
  } catch (e) {
    if (!isMissingBinaryError(e) || runningInsideDocker()) throw e;
    if (await isDockerContainerRunning(DEFAULT_DOCKER_CONTAINER)) {
      await dockerPsqlRestore(filepath, conn);
      return;
    }
    throw e;
  }
}

module.exports = {
  createPostgresBackup,
  restorePostgresBackup,
  parsePgConnection,
  DEFAULT_DOCKER_CONTAINER,
  runningInsideDocker,
};
