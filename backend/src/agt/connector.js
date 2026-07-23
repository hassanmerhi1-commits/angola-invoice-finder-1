/**
 * AGT API connector — real HTTP when configured, otherwise deterministic stub.
 * Production never invents CUCE codes unless AGT_SIMULATE=true is set explicitly.
 */
const crypto = require('crypto');

const SANDBOX_DEFAULT_URL = 'https://sandbox.agt.gov.ao/api/v1/documents';
const PRODUCTION_DEFAULT_URL = 'https://api.agt.gov.ao/api/v1/documents';

function resolveApiUrl(config) {
  if (config?.apiUrl) return config.apiUrl.trim();
  if (process.env.AGT_API_URL) return process.env.AGT_API_URL.trim();
  return config?.environment === 'production' ? PRODUCTION_DEFAULT_URL : SANDBOX_DEFAULT_URL;
}

function resolveStatusUrl(config) {
  if (config?.statusUrl) return config.statusUrl.trim();
  if (process.env.AGT_STATUS_URL) return process.env.AGT_STATUS_URL.trim();
  const base = resolveApiUrl(config).replace(/\/documents\/?$/, '');
  return `${base}/status`;
}

function isProductionLike() {
  return process.env.NODE_ENV === 'production' || process.env.NEXOR_PRODUCTION === '1';
}

function shouldSimulate(config) {
  // Production: only invent CUCE when AGT_SIMULATE=true is set explicitly.
  // DB "simulate" flag must never override this (operators may leave it on from sandbox).
  if (isProductionLike()) {
    return process.env.AGT_SIMULATE === 'true';
  }
  if (process.env.AGT_SIMULATE === 'true') return true;
  if (process.env.AGT_SIMULATE === 'false') return false;
  if (config?.simulate === true) return true;
  if (config?.simulate === false) return false;
  if (!resolveApiUrl(config)) return true;
  return config?.simulate !== false;
}

async function httpPost(url, body, apiKey) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(parsed.message || parsed.error || `AGT HTTP ${res.status}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

async function httpGet(url, apiKey) {
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(parsed.message || parsed.error || `AGT HTTP ${res.status}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

function normalizeResponse(body) {
  const agtCode = body.agtCode || body.cuce || body.code || body.validationCode || '';
  const agtStatus = String(body.status || body.agtStatus || 'validated').toLowerCase();
  return {
    agtCode,
    agtStatus: agtStatus === 'success' ? 'validated' : agtStatus,
    responsePayload: body,
    validatedAt: body.validatedAt || body.validated_at || new Date().toISOString(),
  };
}

function simulatedTransmit(payload) {
  const prefix = payload.documentType || 'FT';
  const agtCode = `CUCE-${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  return {
    agtCode,
    agtStatus: 'validated',
    responsePayload: {
      status: 'validated',
      agtCode,
      simulated: true,
      documentNumber: payload.documentNumber,
    },
    validatedAt: new Date().toISOString(),
  };
}

async function transmitDocument(payload, config) {
  if (shouldSimulate(config)) {
    return simulatedTransmit(payload);
  }

  const url = resolveApiUrl(config);
  const apiKey = config?.apiKey || process.env.AGT_API_KEY;
  if (!apiKey) {
    const err = new Error('AGT API key is not configured');
    err.code = 'AGT_NOT_CONFIGURED';
    throw err;
  }
  const body = await httpPost(url, payload, apiKey);
  return normalizeResponse(body);
}

async function transmitVoid(payload, config) {
  if (shouldSimulate(config)) {
    return {
      agtCode: null,
      agtStatus: 'voided',
      responsePayload: {
        status: 'voided',
        simulated: true,
        documentNumber: payload.documentNumber || payload.originalDocumentNumber,
        reason: payload.reason,
      },
      validatedAt: new Date().toISOString(),
    };
  }

  const url = resolveApiUrl(config).replace(/\/documents\/?$/, '/void');
  const apiKey = config?.apiKey || process.env.AGT_API_KEY;
  if (!apiKey) {
    const err = new Error('AGT API key is not configured');
    err.code = 'AGT_NOT_CONFIGURED';
    throw err;
  }
  const body = await httpPost(url, payload, apiKey);
  return normalizeResponse({ ...body, status: body.status || 'voided' });
}

async function checkDocumentStatus(documentNumber, config) {
  if (shouldSimulate(config)) {
    return {
      documentNumber,
      agtStatus: 'validated',
      simulated: true,
    };
  }
  const base = resolveStatusUrl(config);
  const url = `${base}/${encodeURIComponent(documentNumber)}`;
  const body = await httpGet(url, config?.apiKey || process.env.AGT_API_KEY);
  return normalizeResponse(body);
}

/** @deprecated use transmitDocument */
async function transmitInvoice(payload) {
  const { getAgtConfigWithSecrets } = require('./agtConfig');
  const config = await getAgtConfigWithSecrets();
  return transmitDocument(payload, config);
}

module.exports = {
  transmitDocument,
  transmitInvoice,
  transmitVoid,
  checkDocumentStatus,
  shouldSimulate,
};
