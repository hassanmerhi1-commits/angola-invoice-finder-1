/**
 * Unified fiscal document signing — hash chain + optional RSA-SHA256 (PKCS#12).
 * Canonical string format matches existing NEXOR sales signing for backward compatibility.
 */
const crypto = require('crypto');
const db = require('../db');
const { loadActiveSigningMaterial } = require('./certificateStore');

const ENTITY_TABLE = {
  sale: { table: 'sales', numberCol: 'invoice_number', dateCol: 'created_at', totalCol: 'total' },
  credit_note: { table: 'credit_notes', numberCol: 'document_number', dateCol: 'issued_at', totalCol: 'total' },
  debit_note: { table: 'debit_notes', numberCol: 'document_number', dateCol: 'issued_at', totalCol: 'total' },
  transport_document: {
    table: 'transport_documents',
    numberCol: 'document_number',
    dateCol: 'issued_at',
    totalCol: 'total',
  },
};

function roundMoney(value) {
  return Number(value || 0).toFixed(2);
}

function buildCanonicalString({ documentDate, systemDate, documentNumber, total, previousHash }) {
  return [
    documentDate,
    systemDate,
    documentNumber,
    roundMoney(total),
    previousHash || '0',
  ].join(';');
}

function hashCanonical(canonicalString) {
  return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
}

function shortHashFromFull(fullHash) {
  return String(fullHash || '').substring(0, 4).toUpperCase();
}

function rsaSignCanonical(canonicalString, privateKeyPem) {
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(canonicalString, 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

async function getPreviousShortHash(tableName, branchId, excludeId) {
  const result = await db.query(
    `SELECT saft_hash FROM ${tableName}
     WHERE branch_id IS NOT DISTINCT FROM $1
       AND id != $2
       AND saft_hash IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [branchId, excludeId],
  );
  return result.rows[0]?.saft_hash || '0';
}

async function persistFiscalSignature({
  entityType,
  entityId,
  documentNumber,
  branchId,
  signingKeyId,
  contentHash,
  previousHash,
  signatureData,
  algorithm,
  systemEntryDate,
}) {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO fiscal_signatures (
      id, entity_type, entity_id, document_number, branch_id,
      signing_key_id, content_hash, previous_hash, signature_data, algorithm, system_entry_date
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (entity_type, entity_id) DO UPDATE SET
      document_number = EXCLUDED.document_number,
      signing_key_id = EXCLUDED.signing_key_id,
      content_hash = EXCLUDED.content_hash,
      previous_hash = EXCLUDED.previous_hash,
      signature_data = EXCLUDED.signature_data,
      algorithm = EXCLUDED.algorithm,
      system_entry_date = EXCLUDED.system_entry_date,
      signed_at = CURRENT_TIMESTAMP`,
    [
      id,
      entityType,
      entityId,
      documentNumber,
      branchId || null,
      signingKeyId || null,
      contentHash,
      previousHash || null,
      signatureData || null,
      algorithm,
      systemEntryDate || null,
    ],
  );

  if (entityType === 'sale') {
    try {
      await db.query(
        `INSERT INTO invoice_signatures (
          invoice_id, invoice_number, signing_key_id, signature_data, signed_content_hash, algorithm
        ) VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (invoice_id) DO UPDATE SET
          signing_key_id = EXCLUDED.signing_key_id,
          signature_data = EXCLUDED.signature_data,
          signed_content_hash = EXCLUDED.signed_content_hash,
          algorithm = EXCLUDED.algorithm`,
        [
          entityId,
          documentNumber,
          signingKeyId || null,
          signatureData || null,
          contentHash,
          algorithm,
        ],
      );
    } catch (_) {
      /* legacy sqlite without unique constraint */
    }
  }
}

/**
 * Sign a fiscal document row already persisted in the database.
 */
async function signFiscalEntity(entityType, entityId, options = {}) {
  const config = ENTITY_TABLE[entityType];
  if (!config) throw new Error(`Unsupported entity type: ${entityType}`);

  const docRes = await db.query(`SELECT * FROM ${config.table} WHERE id = $1`, [entityId]);
  if (!docRes.rows.length) return null;
  const doc = docRes.rows[0];

  const documentNumber = doc[config.numberCol];
  const branchId = doc.branch_id;
  const documentDate = doc[config.dateCol] || doc.created_at || new Date().toISOString();
  const total = options.total != null
    ? options.total
    : Number(doc[config.totalCol] ?? doc.total_weight ?? 0);
  const systemDate = options.systemDate || new Date().toISOString();

  const previousHash = await getPreviousShortHash(config.table, branchId, entityId);
  const canonicalString = buildCanonicalString({
    documentDate,
    systemDate,
    documentNumber,
    total,
    previousHash,
  });
  const contentHash = hashCanonical(canonicalString);
  const shortHash = shortHashFromFull(contentHash);

  let signatureData = null;
  let signingKeyId = null;
  let algorithm = 'SHA-256';

  const signingMaterial = await loadActiveSigningMaterial();
  if (signingMaterial?.privateKeyPem) {
    signatureData = rsaSignCanonical(canonicalString, signingMaterial.privateKeyPem);
    signingKeyId = signingMaterial.keyId;
    algorithm = 'RSA-SHA256';
  }

  await db.query(
    `UPDATE ${config.table} SET saft_hash = $1 WHERE id = $2`,
    [shortHash, entityId],
  );

  await persistFiscalSignature({
    entityType,
    entityId,
    documentNumber,
    branchId,
    signingKeyId,
    contentHash,
    previousHash,
    signatureData,
    algorithm,
    systemEntryDate: systemDate,
  });

  return {
    canonicalString,
    contentHash,
    shortHash,
    previousHash,
    signatureData,
    algorithm,
    signingKeyId,
  };
}

async function verifyFiscalEntity(entityType, entityId) {
  const config = ENTITY_TABLE[entityType];
  if (!config) throw new Error(`Unsupported entity type: ${entityType}`);

  const sigRes = await db.query(
    `SELECT fs.*, sk.public_key_pem
     FROM fiscal_signatures fs
     LEFT JOIN signing_keys sk ON sk.id = fs.signing_key_id
     WHERE fs.entity_type = $1 AND fs.entity_id = $2`,
    [entityType, entityId],
  );
  if (!sigRes.rows.length) {
    return { valid: false, reason: 'no_signature_record' };
  }
  const sig = sigRes.rows[0];
  if (!sig.signature_data || !sig.public_key_pem) {
    return {
      valid: true,
      mode: 'hash-only',
      contentHash: sig.content_hash,
      algorithm: sig.algorithm,
    };
  }

  const docRes = await db.query(`SELECT * FROM ${config.table} WHERE id = $1`, [entityId]);
  if (!docRes.rows.length) return { valid: false, reason: 'document_missing' };
  const doc = docRes.rows[0];
  const documentDate = doc[config.dateCol] || doc.created_at;
  const canonicalString = buildCanonicalString({
    documentDate,
    systemDate: sig.system_entry_date || sig.signed_at || documentDate,
    documentNumber: doc[config.numberCol],
    total: Number(doc[config.totalCol] ?? doc.total_weight ?? 0),
    previousHash: sig.previous_hash || '0',
  });
  const recomputed = hashCanonical(canonicalString);
  const hashValid = recomputed === sig.content_hash;

  let rsaValid = true;
  if (sig.signature_data && sig.public_key_pem) {
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(canonicalString, 'utf8');
    verifier.end();
    rsaValid = verifier.verify(sig.public_key_pem, sig.signature_data, 'base64');
  }

  return {
    valid: hashValid && rsaValid,
    hashValid,
    rsaValid,
    mode: sig.signature_data ? 'rsa' : 'hash-only',
    contentHash: sig.content_hash,
    algorithm: sig.algorithm,
  };
}

async function getSigningStatus() {
  const material = await loadActiveSigningMaterial();
  const keysRes = await db.query(
    `SELECT id, key_alias, key_type, certificate_number, subject_cn, valid_from, valid_until, is_active
     FROM signing_keys ORDER BY created_at DESC`,
  ).catch(() => ({ rows: [] }));

  return {
    mode: material?.privateKeyPem ? 'rsa' : 'hash-only',
    activeKeyId: material?.keyId || null,
    activeKeyAlias: material?.keyAlias || null,
    publicKeyPem: material?.publicKeyPem || null,
    certificates: keysRes.rows.map((row) => ({
      id: row.id,
      alias: row.key_alias,
      keyType: row.key_type,
      certificateNumber: row.certificate_number,
      subjectCn: row.subject_cn,
      validFrom: row.valid_from,
      validUntil: row.valid_until,
      isActive: row.is_active === true || row.is_active === 1,
    })),
  };
}

module.exports = {
  ENTITY_TABLE,
  buildCanonicalString,
  hashCanonical,
  shortHashFromFull,
  signFiscalEntity,
  verifyFiscalEntity,
  getSigningStatus,
};
