/**
 * Prepare ports/processes for `npm run electron:dev`.
 * - 18080 (Vite): must be free or a stale vite from this repo — otherwise exit.
 * - 3000–3009: only stop stale backends from THIS repo; other apps (installed NEXOR)
 *   are left alone — BackendManager picks the next free port.
 * - Orphan dev Electron windows from prior crashed sessions are closed.
 */
const net = require('net');
const path = require('path');
const { execSync } = require('child_process');

const HOST = '127.0.0.1';
const VITE_PORT = 18080;
const BACKEND_PORT_START = 3000;
const BACKEND_PORT_COUNT = 10;
const REPO_ROOT = path.join(__dirname, '..').toLowerCase().replace(/\//g, '\\');
const REPO_SLUG = 'angola-invoice-finder';

function probe(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, HOST, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(800, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function localPortFromNetstatLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const addr = parts[1];
  const colon = addr.lastIndexOf(':');
  if (colon === -1) return null;
  const port = Number(addr.slice(colon + 1));
  return Number.isFinite(port) ? port : null;
}

function findListeningPid(port) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync('netstat -ano -p tcp', { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      if (localPortFromNetstatLine(line) !== port) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch {
    /* port free */
  }
  return null;
}

function processInfo(pid) {
  if (process.platform !== 'win32') return { commandLine: '', name: '' };
  try {
    const out = execSync(
      `powershell -NoProfile -Command "$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; `
        + `if($p){$p.Name+'|'+($p.CommandLine -replace '\\|','/')}"`,
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    const sep = out.indexOf('|');
    if (sep === -1) return { commandLine: '', name: out.toLowerCase() };
    return {
      name: out.slice(0, sep).trim().toLowerCase(),
      commandLine: out.slice(sep + 1).trim(),
    };
  } catch {
    return { commandLine: '', name: '' };
  }
}

function killPid(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function fromThisRepo(commandLine) {
  const cmd = commandLine.toLowerCase().replace(/\//g, '\\');
  return cmd.includes(REPO_ROOT) || cmd.includes(REPO_SLUG);
}

function looksLikeViteDevServer({ commandLine, name }) {
  const cmd = commandLine.toLowerCase();
  return cmd.includes('vite')
    || cmd.includes(String(VITE_PORT))
    || (cmd.includes('node') && cmd.includes('vite'))
    || (name === 'node.exe' && fromThisRepo(commandLine) && cmd.includes('dev'));
}

function looksLikeNexorBackend({ commandLine, name }) {
  const cmd = commandLine.toLowerCase();
  return (name === 'electron.exe' || name === 'node.exe')
    && cmd.includes('server.js');
}

function looksLikeStaleDevBackend(info) {
  return looksLikeNexorBackend(info) && fromThisRepo(info.commandLine);
}

function cleanupOrphanedDevElectron() {
  if (process.platform !== 'win32') return;
  try {
    const repoEsc = REPO_ROOT.replace(/'/g, "''");
    const slugEsc = REPO_SLUG.replace(/'/g, "''");
    const out = execSync(
      `powershell -NoProfile -Command `
        + `"Get-CimInstance Win32_Process -Filter \\"Name='electron.exe'\\" | `
        + `Where-Object { $_.CommandLine -and `
        + `($_.CommandLine -like '*${slugEsc}*' -or $_.CommandLine -like '*${repoEsc}*') `
        + `-and $_.CommandLine -notlike '*server.js*' } | `
        + `Select-Object -ExpandProperty ProcessId"`,
      { encoding: 'utf8', windowsHide: true },
    ).trim();
    if (!out) return;
    for (const line of out.split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (!Number.isFinite(pid) || pid <= 0) continue;
      console.warn(`[electron:dev] Closing orphaned dev Electron window (PID ${pid})...`);
      killPid(pid);
    }
    if (out) {
      // Let child backends release ports.
      // eslint-disable-next-line no-promise-executor-return
      return new Promise((r) => setTimeout(r, 800));
    }
  } catch {
    /* best effort */
  }
  return Promise.resolve();
}

async function freeVitePort() {
  if (!(await probe(VITE_PORT))) return;

  const pid = findListeningPid(VITE_PORT);
  if (!pid) {
    console.warn(
      `[electron:dev] Port ${VITE_PORT} is in use but PID could not be resolved. `
        + 'Close the other app using this port, then retry.',
    );
    process.exit(1);
  }

  const info = processInfo(pid);
  if (!looksLikeViteDevServer(info)) {
    console.warn(
      `[electron:dev] Port ${VITE_PORT} is used by PID ${pid} (not a stale vite dev server). `
        + `Process: ${info.name || '(unknown)'} Command: ${info.commandLine.slice(0, 120) || '(unknown)'}`,
    );
    process.exit(1);
  }

  console.warn(`[electron:dev] Stopping stale vite dev server on port ${VITE_PORT} (PID ${pid})...`);
  if (!killPid(pid)) {
    console.error(`[electron:dev] Could not stop PID ${pid}. Close it manually and retry.`);
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 600));
  if (await probe(VITE_PORT)) {
    console.error(`[electron:dev] Port ${VITE_PORT} is still in use after cleanup.`);
    process.exit(1);
  }
  console.log(`[electron:dev] Port ${VITE_PORT} is free.`);
}

async function freeStaleDevBackendPorts() {
  for (let i = 0; i < BACKEND_PORT_COUNT; i++) {
    const port = BACKEND_PORT_START + i;
    // eslint-disable-next-line no-await-in-loop
    if (!(await probe(port))) continue;

    const pid = findListeningPid(port);
    if (!pid) {
      console.warn(`[electron:dev] Port ${port} is busy (PID unknown) — backend will try the next port.`);
      continue;
    }

    const info = processInfo(pid);
    if (!looksLikeStaleDevBackend(info)) {
      console.warn(
        `[electron:dev] Port ${port} used by PID ${pid} (${info.name || 'unknown'}) — leaving it. `
          + 'Dev backend will bind to the next free port. Close the installed NEXOR ERP if you need 3000.',
      );
      continue;
    }

    console.warn(`[electron:dev] Stopping stale dev backend on port ${port} (PID ${pid})...`);
    killPid(pid);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 400));
  }
}

(async () => {
  await cleanupOrphanedDevElectron();
  await freeStaleDevBackendPorts();
  await freeVitePort();
})();
