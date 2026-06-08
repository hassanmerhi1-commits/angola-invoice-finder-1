/**
 * Load AGT API settings from env + C:\NEXOR ERP\sync.env (shop client).
 */
const fs = require('fs');
const path = require('path');

const INSTALL_DIR = process.env.NEXOR_INSTALL_DIR || 'C:\\NEXOR ERP';

function parseEnvFile(filePath, into) {
  if (!fs.existsSync(filePath)) return;
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"'))
        || (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      into[key] = val;
    }
  } catch {
    /* ignore */
  }
}

function loadAgtEnv() {
  const merged = {};
  const candidates = [
    path.join(INSTALL_DIR, 'sync.env'),
    path.join(INSTALL_DIR, 'database.env'),
    path.join(process.cwd(), 'sync.env'),
  ];
  for (const file of candidates) {
    parseEnvFile(file, merged);
  }

  const url = (process.env.AGT_API_URL || merged.AGT_API_URL || '').trim();
  const apiKey = (process.env.AGT_API_KEY || merged.AGT_API_KEY || '').trim();
  const simulateRaw = process.env.AGT_SIMULATE ?? merged.AGT_SIMULATE;
  const simulate = simulateRaw === undefined || simulateRaw === ''
    ? !url
    : String(simulateRaw).toLowerCase() !== 'false';

  return { AGT_API_URL: url, AGT_API_KEY: apiKey, AGT_SIMULATE: simulate };
}

function applyAgtEnvToProcess() {
  const cfg = loadAgtEnv();
  if (cfg.AGT_API_URL) process.env.AGT_API_URL = cfg.AGT_API_URL;
  if (cfg.AGT_API_KEY) process.env.AGT_API_KEY = cfg.AGT_API_KEY;
  process.env.AGT_SIMULATE = cfg.AGT_SIMULATE ? 'true' : 'false';
  return cfg;
}

module.exports = { loadAgtEnv, applyAgtEnvToProcess, INSTALL_DIR };
