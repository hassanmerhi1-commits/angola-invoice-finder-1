/**
 * AGT Facturação Electrónica connector.
 * Homologation: https://sifphml.minfin.gov.ao/sigt/fe/v1
 * Production:   https://sifp.minfin.gov.ao/sigt/fe/v1
 * Auth: Basic (username + password). Simulate remains the default until credentials exist.
 */
const crypto = require('crypto');

const HML_BASE = 'https://sifphml.minfin.gov.ao/sigt/fe/v1';
const PROD_BASE = 'https://sifp.minfin.gov.ao/sigt/fe/v1';
const LEGACY_PLACEHOLDER = 'sandbox.agt.gov.ao';

function environmentBase(config) {
  return config?.environment === 'production' ? PROD_BASE : HML_BASE;
}

function isPlaceholderUrl(url) {
  const u = String(url || '');
  return !u || u.includes(LEGACY_PLACEHOLDER) || u.includes('api.agt.gov.ao');
}

function resolveApiUrl(config) {
  const explicit = (config?.apiUrl || process.env.AGT_API_URL || '').trim();
  if (explicit && !isPlaceholderUrl(explicit)) return explicit.replace(/\/$/, '');
  return `${environmentBase(config)}/registarFactura`;
}

function resolveStatusUrl(config) {
  const explicit = (config?.statusUrl || process.env.AGT_STATUS_URL || '').trim();
  if (explicit && !isPlaceholderUrl(explicit)) return explicit.replace(/\/$/, '');
  return `${environmentBase(config)}/obterEstado`;
}

function resolveUsername(config) {
  return String(config?.apiUsername || config?.username || process.env.AGT_API_USERNAME || '').trim();
}

function resolvePassword(config) {
  return String(config?.apiKey || process.env.AGT_API_KEY || '').trim();
}

function hasLiveCredentials(config) {
  return Boolean(resolveUsername(config) && resolvePassword(config));
}

function authorizationHeader(config) {
  const username = resolveUsername(config);
  const password = resolvePassword(config);
  if (username && password) {
    return `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
  }
  if (password) return `Bearer ${password}`;
  return null;
}

function isProductionLike() {
  return process.env.NODE_ENV === 'production' || process.env.NEXOR_PRODUCTION === '1';
}

function shouldSimulate(config) {
  if (isProductionLike()) {
    return process.env.AGT_SIMULATE === 'true';
  }
  if (process.env.AGT_SIMULATE === 'true') return true;
  if (process.env.AGT_SIMULATE === 'false') return false;
  if (config?.simulate === true) return true;
  if (config?.simulate === false) return false;
  return true;
}

async function httpJson(method, url, body, config) {
  const auth = authorizationHeader(config);
  const res = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth ? { Authorization: auth } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text };
  }
  if (!res.ok) {
    const firstError = Array.isArray(parsed.errorList) && parsed.errorList[0]
      ? `${parsed.errorList[0].idError || ''} ${parsed.errorList[0].descriptionError || parsed.errorList[0].description || ''}`.trim()
      : '';
    const err = new Error(firstError || parsed.message || parsed.error || `AGT HTTP ${res.status}`);
    err.status = res.status;
    err.body = parsed;
    throw err;
  }
  return parsed;
}

function firstErrorList(body) {
  const list = body?.errorList || body?.requestErrorList || [];
  if (!Array.isArray(list) || list.length === 0) return '';
  return list
    .map((row) => `${row.idError || row.code || ''} ${row.descriptionError || row.description || ''}`.trim())
    .filter(Boolean)
    .join('; ');
}

function normalizeResponse(body) {
  const errors = firstErrorList(body);
  const requestId = body.requestID || body.requestId || '';
  const agtCode = body.agtCode || body.cuce || body.code || body.validationCode || body.atcud || '';
  const atcud = body.atcud || body.ATCUD || '';
  let agtStatus = String(body.status || body.agtStatus || '').toLowerCase();
  if (!agtStatus) {
    agtStatus = agtCode ? 'validated' : (requestId ? 'submitted' : 'pending');
  }
  if (agtStatus === 'success' || agtStatus === 'valid' || agtStatus === 'valido') {
    agtStatus = 'validated';
  }
  if (errors && !agtCode && !requestId) {
    const err = new Error(errors);
    err.status = 400;
    err.body = body;
    throw err;
  }
  return {
    agtCode: agtCode || requestId || '',
    atcud: atcud || '',
    requestId: requestId || '',
    agtStatus,
    responsePayload: body,
    validatedAt: body.validatedAt || body.validated_at || (agtStatus === 'validated' ? new Date().toISOString() : null),
  };
}

function simulatedTransmit(payload) {
  const doc = payload?.documents?.[0] || payload;
  const prefix = doc.documentType || payload.documentType || 'FT';
  const number = doc.documentNo || payload.documentNumber || '';
  const agtCode = `CUCE-${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  return {
    agtCode,
    atcud: '0',
    requestId: '',
    agtStatus: 'validated',
    responsePayload: {
      status: 'validated',
      agtCode,
      simulated: true,
      documentNumber: number,
    },
    validatedAt: new Date().toISOString(),
  };
}

async function transmitDocument(payload, config) {
  if (shouldSimulate(config)) {
    return simulatedTransmit(payload);
  }
  if (!hasLiveCredentials(config)) {
    const err = new Error('Credenciais AGT (utilizador e senha SIFP) não configuradas');
    err.code = 'AGT_NOT_CONFIGURED';
    throw err;
  }
  const url = resolveApiUrl(config);
  const body = await httpJson('POST', url, payload, config);
  return normalizeResponse(body);
}

async function transmitVoid(payload, config) {
  if (shouldSimulate(config)) {
    return {
      agtCode: null,
      atcud: '',
      requestId: '',
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
  if (!hasLiveCredentials(config)) {
    const err = new Error('Credenciais AGT (utilizador e senha SIFP) não configuradas');
    err.code = 'AGT_NOT_CONFIGURED';
    throw err;
  }
  const url = resolveApiUrl(config).replace(/registarFactura\/?$/, 'anularFactura');
  const body = await httpJson('POST', url, payload, config);
  return normalizeResponse({ ...body, status: body.status || 'voided' });
}

/** obterEstado HTTP errors that only mean "ask again later". */
const RETRY_LATER_CODES = new Set(['E96', 'E97', 'E98']);

function errorEntries(body) {
  const list = []
    .concat(Array.isArray(body?.requestErrorList) ? body.requestErrorList : [])
    .concat(Array.isArray(body?.errorList) ? body.errorList : [])
    .concat(body?.errorCode || body?.idError ? [body] : []);
  return list
    .map((row) => ({
      code: String(row?.errorCode || row?.idError || row?.code || '').trim(),
      description: String(row?.errorDescription || row?.descriptionError || row?.description || '').trim(),
    }))
    .filter((row) => row.code || row.description);
}

/**
 * Map an obterEstado response onto NEXOR statuses.
 * resultCode: 0 all valid, 1 mixed, 2 none valid, 7 too early/repeated, 8 processing, 9 cancelled.
 * documentStatus per document: V valid, I invalid.
 */
function interpretStatusResponse(body, documentNo) {
  const resultCode = Number(body?.resultCode);
  const list = Array.isArray(body?.documentStatusList) ? body.documentStatusList : [];
  const target = String(documentNo || '').trim();
  const entry = list.find((row) => String(row?.documentNo || '').trim() === target) || (list.length === 1 ? list[0] : null);
  const base = {
    requestId: String(body?.requestID || ''),
    resultCode: Number.isFinite(resultCode) ? resultCode : null,
    responsePayload: body,
  };

  if (resultCode === 7 || resultCode === 8 || (!Number.isFinite(resultCode) && !entry)) {
    return { ...base, agtStatus: 'submitted', retryLater: true, errors: [] };
  }
  if (resultCode === 9) {
    return { ...base, agtStatus: 'invalid', errors: [{ code: 'R09', description: 'Processamento cancelado pela AGT' }] };
  }
  const status = String(entry?.documentStatus || '').toUpperCase();
  if (status === 'V') {
    return { ...base, agtStatus: 'validated', validatedAt: new Date().toISOString(), errors: [] };
  }
  if (status === 'I' || resultCode === 2) {
    const errors = errorEntries({ errorList: entry?.errorList || [] });
    return { ...base, agtStatus: 'invalid', errors };
  }
  return { ...base, agtStatus: 'submitted', retryLater: true, errors: [] };
}

/**
 * @param {string} documentNo AGT documentNo as transmitted (e.g. "FR FR-SOY-2026-00001")
 * @param {object} options { requestId, privateKeyPem, softwarePrivateKeyPem }
 */
async function checkDocumentStatus(documentNo, config, options = {}) {
  if (shouldSimulate(config)) {
    return {
      documentNumber: documentNo,
      agtStatus: 'validated',
      simulated: true,
    };
  }
  const requestId = String(options.requestId || '').trim();
  if (!requestId) {
    const err = new Error('Sem requestID da AGT — volte a transmitir o documento');
    err.code = 'AGT_NO_REQUEST_ID';
    throw err;
  }
  if (!options.privateKeyPem) {
    const err = new Error('Chave privada do contribuinte em falta para consultar o estado na AGT');
    err.code = 'AGT_NO_KEY';
    throw err;
  }
  const { buildObterEstadoPayload } = require('./fePayload');
  const payload = buildObterEstadoPayload({
    config,
    requestId,
    privateKeyPem: options.privateKeyPem,
    softwarePrivateKeyPem: options.softwarePrivateKeyPem,
  });
  try {
    const body = await httpJson('POST', resolveStatusUrl(config), payload, config);
    return interpretStatusResponse(body, documentNo);
  } catch (err) {
    const codes = errorEntries(err.body || {}).map((e) => e.code);
    // 400 + E96 is a malformed request (a real error); 422 + E96/E97 and 429 + E98 mean "later".
    if (err.status === 429 || (err.status === 422 && codes.some((c) => RETRY_LATER_CODES.has(c)))) {
      return {
        requestId,
        agtStatus: 'submitted',
        retryLater: true,
        errors: errorEntries(err.body || {}),
        responsePayload: err.body || null,
      };
    }
    throw err;
  }
}

/** @deprecated use transmitDocument */
async function transmitInvoice(payload) {
  const { getAgtConfigWithSecrets } = require('./agtConfig');
  const config = await getAgtConfigWithSecrets();
  return transmitDocument(payload, config);
}

module.exports = {
  HML_BASE,
  PROD_BASE,
  transmitDocument,
  transmitInvoice,
  transmitVoid,
  checkDocumentStatus,
  interpretStatusResponse,
  shouldSimulate,
  hasLiveCredentials,
  resolveApiUrl,
  resolveStatusUrl,
  authorizationHeader,
  isPlaceholderUrl,
};
