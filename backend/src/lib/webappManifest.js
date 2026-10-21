const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SKIP_DIRS = new Set(['node_modules', '.git']);

function listWebappFiles(webappPath, { maxFiles = 400 } = {}) {
  const files = [];
  const root = path.resolve(webappPath);
  function walk(dir, prefix) {
    if (files.length >= maxFiles) return;
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (files.length >= maxFiles) return;
      if (!ent.name || ent.name.startsWith('.')) continue;
      if (SKIP_DIRS.has(ent.name)) continue;
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(abs, rel);
      } else {
        files.push(rel.replace(/\\/g, '/'));
      }
    }
  }
  if (fs.existsSync(root)) walk(root, '');
  return files;
}

function webappStampFromHtml(html) {
  return crypto.createHash('sha1').update(String(html || '')).digest('hex').slice(0, 16);
}

function buildWebappManifest(webappPath) {
  const indexPath = path.join(webappPath, 'index.html');
  let stamp = null;
  try {
    stamp = webappStampFromHtml(fs.readFileSync(indexPath, 'utf8'));
  } catch {
    stamp = null;
  }
  return {
    ok: true,
    stamp,
    files: listWebappFiles(webappPath),
  };
}

module.exports = {
  listWebappFiles,
  webappStampFromHtml,
  buildWebappManifest,
};
