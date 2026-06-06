/**
 * Free Vite dev port 18080 when a stale node/vite process is still listening
 * (common after an unclean exit — otherwise vite fails strictPort and Electron dies).
 */
const net = require('net');
const { execSync } = require('child_process');

const HOST = '127.0.0.1';
const PORT = 18080;

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

function findListeningPid(port) {
  if (process.platform !== 'win32') return null;
  try {
    const out = execSync(`netstat -ano -p tcp | findstr :${port}`, { encoding: 'utf8' });
    for (const line of out.split(/\r?\n/)) {
      if (!/LISTENING/i.test(line)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isFinite(pid) && pid > 0) return pid;
    }
  } catch {
    /* port free */
  }
  return null;
}

function processCommandLine(pid) {
  if (process.platform !== 'win32') return '';
  try {
    const out = execSync(
      `wmic process where "ProcessId=${pid}" get CommandLine /value`,
      { encoding: 'utf8', windowsHide: true },
    );
    const match = out.match(/CommandLine=(.*)/);
    return match ? match[1].trim() : '';
  } catch {
    return '';
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

(async () => {
  if (!(await probe(PORT))) return;

  const pid = findListeningPid(PORT);
  if (!pid) {
    console.warn(
      `[electron:dev] Port ${PORT} is in use but PID could not be resolved. `
        + 'Close the other app using this port, then retry.',
    );
    process.exit(1);
  }

  const cmd = processCommandLine(pid).toLowerCase();
  const looksLikeDevServer =
    cmd.includes('vite')
    || cmd.includes('18080')
    || (cmd.includes('node') && (cmd.includes('dev') || cmd.includes('nexor')));

  if (!looksLikeDevServer) {
    console.warn(
      `[electron:dev] Port ${PORT} is used by PID ${pid} (not a known vite dev server). `
        + `Command: ${cmd.slice(0, 120) || '(unknown)'}`,
    );
    process.exit(1);
  }

  console.warn(`[electron:dev] Stopping stale dev server on port ${PORT} (PID ${pid})...`);
  if (!killPid(pid)) {
    console.error(`[electron:dev] Could not stop PID ${pid}. Close it manually and retry.`);
    process.exit(1);
  }

  await new Promise((r) => setTimeout(r, 600));
  if (await probe(PORT)) {
    console.error(`[electron:dev] Port ${PORT} is still in use after cleanup.`);
    process.exit(1);
  }
  console.log(`[electron:dev] Port ${PORT} is free.`);
})();
