#!/usr/bin/env node
/**
 * AGT certification readiness — automated API checks.
 *
 * Usage:
 *   NEXOR_API_URL=http://127.0.0.1:3000 \
 *   NEXOR_ADMIN_EMAIL=admin@kwanzaerp.ao \
 *   NEXOR_ADMIN_PASSWORD=changeme \
 *   node scripts/agt-certification/run-readiness-check.mjs
 */
const baseUrl = (process.env.NEXOR_API_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
const email = process.env.NEXOR_ADMIN_EMAIL || 'admin@kwanzaerp.ao';
const password = process.env.NEXOR_ADMIN_PASSWORD || '';

let exitCode = 0;

function pass(label, detail = '') {
  console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
}

function warn(label, detail = '') {
  console.log(`  ⚠ ${label}${detail ? ` — ${detail}` : ''}`);
}

function fail(label, detail = '') {
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  exitCode = 1;
}

async function fetchJson(path, options = {}) {
  const res = await fetch(`${baseUrl}${path}`, options);
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data };
}

async function login() {
  const { status, data } = await fetchJson('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (status !== 200 || !data?.token) {
    throw new Error(data?.error || `Login failed (${status}) — set NEXOR_ADMIN_PASSWORD`);
  }
  return data.token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function main() {
  console.log('NEXOR AGT certification readiness check');
  console.log(`API: ${baseUrl}`);
  console.log('');

  // Health (no auth)
  console.log('1. Health');
  try {
    const { status, data } = await fetchJson('/api/health');
    if (status === 200 && data?.ok) {
      pass('Backend healthy', `engine=${data.engine || '?'}`);
      const schema = data.schemaVersion ?? data.deployment?.schema?.stored;
      if (schema != null && Number(schema) >= 42) {
        pass('Schema version', String(schema));
      } else if (schema != null) {
        warn('Schema version', `${schema} (expected ≥ 42)`);
      } else {
        warn('Schema version', 'not reported on /api/health');
      }
    } else {
      fail('Backend health', `status ${status}`);
    }
  } catch (err) {
    fail('Backend reachable', err.message);
    console.log('\nStart NEXOR ERP or set NEXOR_API_URL.');
    process.exit(1);
  }

  if (!password) {
    warn('Authenticated checks skipped', 'set NEXOR_ADMIN_PASSWORD');
    console.log('\nDone (partial).');
    process.exit(0);
  }

  let token;
  try {
    token = await login();
    pass('Admin login');
  } catch (err) {
    fail('Admin login', err.message);
    process.exit(1);
  }

  const headers = authHeaders(token);

  console.log('\n2. Certification status');
  const cert = await fetchJson('/api/certification/status', { headers });
  if (cert.status === 200 && cert.data) {
    const d = cert.data;
    if (d.readyForInternalReview) pass('Ready for internal review');
    else warn('Internal review', `${d.blockers || 0} blocker(s), ${d.warnings || 0} warning(s)`);

    if (d.readyForAgtSubmission) pass('Ready for AGT submission');
    else warn('AGT submission', 'not yet — see phases below');

    for (const phase of d.phases || []) {
      const icon = phase.status === 'ok' ? '✓' : phase.status === 'warn' ? '⚠' : '✗';
      console.log(`  ${icon} Phase ${phase.phase}: ${phase.title} — ${phase.message}`);
      if (phase.status === 'blocker') exitCode = 1;
    }
  } else if (cert.status === 404) {
    warn('Certification API', 'route missing — sync backend to installed app');
  } else {
    fail('Certification status', `HTTP ${cert.status}`);
  }

  console.log('\n3. Security status');
  const sec = await fetchJson('/api/security/status', { headers });
  if (sec.status === 200 && sec.data?.checks) {
    for (const c of sec.data.checks) {
      if (c.ok) pass(c.id, c.message);
      else if (c.level === 'critical') fail(c.id, c.message);
      else warn(c.id, c.message);
    }
  } else {
    fail('Security status', `HTTP ${sec.status}`);
  }

  console.log('\n4. SAF-T validate (optional)');
  const period = process.env.SAFT_PERIOD;
  if (period) {
    const saft = await fetchJson('/api/saft/validate', {
      method: 'POST',
      headers,
      body: JSON.stringify({ period }),
    });
    if (saft.status === 200 && saft.data?.ok) {
      pass('SAF-T XSD validation', `${period}: ${saft.data.errorCount ?? 0} error(s)`);
    } else {
      warn('SAF-T validation', saft.data?.error || `HTTP ${saft.status}`);
    }
  } else {
    warn('Skipped', 'set SAFT_PERIOD=YYYY-MM to validate a month');
  }

  console.log('\n---');
  console.log(exitCode === 0 ? 'Result: PASS' : 'Result: FAIL (see items above)');
  console.log('Manual demo: scripts/agt-certification/demo-test-script.md');
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
