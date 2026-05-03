import { spawn } from 'node:child_process';

const [, , timeoutArg, ...cmdParts] = process.argv;
const timeoutMs = Number(timeoutArg);

if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || cmdParts.length === 0) {
  console.error('Usage: node scripts/run-with-timeout.mjs <timeoutMs> <command...>');
  process.exit(2);
}

const command = cmdParts.join(' ');
const child = spawn(command, {
  stdio: 'inherit',
  shell: true,
});

let didTimeout = false;
const timer = setTimeout(() => {
  didTimeout = true;
  console.error(`[TIMEOUT] Command exceeded ${timeoutMs}ms: ${command}`);
  try { child.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    try { child.kill('SIGKILL'); } catch {}
  }, 2000);
}, timeoutMs);

child.on('exit', (code) => {
  clearTimeout(timer);
  if (didTimeout) process.exit(124);
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  clearTimeout(timer);
  console.error(`[ERROR] Failed to start command: ${err.message}`);
  process.exit(1);
});
