/**
 * Start Electron for local dev. Must not inherit ELECTRON_RUN_AS_NODE from the shell
 * (breaks require('electron') → ipcMain is undefined).
 */
const { spawn } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const env = { ...process.env, ELECTRON_DEV: 'true' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RUN_AS_NODE_DISABLE_NODE_OPTIONS;

const electronPath = require('electron');
const child = spawn(electronPath, ['.'], {
  cwd: root,
  env,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('exit', (code, signal) => {
  if (code && code !== 0) {
    console.error(`[electron:dev] Electron exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
  }
  process.exit(code ?? 0);
});
