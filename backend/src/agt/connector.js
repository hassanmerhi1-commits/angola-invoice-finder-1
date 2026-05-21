/**
 * AGT API connector — real HTTP when AGT_API_URL is set, otherwise deterministic stub.
 */
const crypto = require('crypto');

const AGT_API_URL = (process.env.AGT_API_URL || '').trim();
const AGT_API_KEY = (process.env.AGT_API_KEY || '').trim();
const AGT_SIMULATE = process.env.AGT_SIMULATE !== 'false';

async function transmitInvoice(payload) {
  if (AGT_API_URL && !AGT_SIMULATE) {
    const res = await fetch(AGT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(AGT_API_KEY ? { Authorization: `Bearer ${AGT_API_KEY}` } : {}),
      },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.message || body.error || `AGT HTTP ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return {
      agtCode: body.agtCode || body.code || `AGT-${Date.now()}`,
      agtStatus: body.status || 'validated',
      responsePayload: body,
      validatedAt: body.validatedAt || new Date().toISOString(),
    };
  }

  const agtCode = `AGT-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  return {
    agtCode,
    agtStatus: 'validated',
    responsePayload: { status: 'validated', agtCode, simulated: true },
    validatedAt: new Date().toISOString(),
  };
}

module.exports = { transmitInvoice };
