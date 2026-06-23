// Authentication routes
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../jwtSecret');
const { requireAdmin } = require('../middleware/requireAdmin');
const { requireAuth } = require('../middleware/requireAuth');
const { loginRateLimiter } = require('../middleware/loginRateLimit');
const { isLocked, recordFailure, recordSuccess } = require('../middleware/loginAttemptGuard');
const { logFiscalEventFromReq } = require('../lib/fiscalAudit');
const {
  hashPassword,
  upgradePasswordHashIfLegacy,
  verifyPassword,
  verifyPasswordWithDummyFallback,
} = require('../lib/passwordAuth');
const { findUserForLogin } = require('../lib/loginUserLookup');
const { resolveAndPersistUserBranchId } = require('../middleware/branchScope');
const { startSession, endSession } = require('../lib/sessionLog');

const router = express.Router();

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '8h';

function mapUserRow(user) {
  const email = String(user.email || '').toLowerCase();
  const username =
    user.username
    || (email.includes('@') ? email.split('@')[0] : email);
  return {
    id: user.id,
    email: user.email,
    username,
    name: user.name,
    role: user.role,
    branchId: user.branch_id,
    isActive: user.is_active === true || user.is_active === 1,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function isValidEmailDomain(domain) {
  const d = String(domain || '').trim().toLowerCase();
  return d.length > 0 && d.includes('.') && !/^\d+$/.test(d);
}

function normalizeUserIdentity(emailRaw, usernameRaw) {
  const emailIn = String(emailRaw || '').trim().toLowerCase();
  const userIn = String(usernameRaw || '').trim().toLowerCase();
  const localFromEmail = emailIn.includes('@') ? emailIn.split('@')[0] : emailIn;
  const username = userIn || localFromEmail;
  let email;
  if (!emailIn.includes('@')) {
    email = `${username}@kwanzaerp.ao`;
  } else {
    const domain = emailIn.split('@')[1] || '';
    email = isValidEmailDomain(domain) ? emailIn : `${username}@kwanzaerp.ao`;
  }
  return { email, username };
}

function normalizeLoginEmail(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (!value) return '';
  if (value.includes('@')) return value;
  return `${value}@kwanzaerp.ao`;
}

function issueToken(user) {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role, jti },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
  return { token, jti };
}

// Login — public, rate-limited
router.post('/login', loginRateLimiter(), async (req, res) => {
  try {
    const rawIdentifier = req.body?.email ?? req.body?.username ?? '';
    const password = req.body?.password;

    if (!String(rawIdentifier).trim()) {
      return res.status(400).json({ error: 'Email or username is required' });
    }
    if (password == null || String(password).length === 0) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const lockState = isLocked(rawIdentifier);
    if (lockState.locked) {
      const retryMinutes = Math.ceil(lockState.retryAfterMs / 60000);
      await logFiscalEventFromReq(req, {
        tableName: 'users',
        action: 'login_locked',
        userName: String(rawIdentifier).trim().slice(0, 120) || 'unknown',
        description: 'Login blocked — account temporarily locked',
        newValues: { identifier: String(rawIdentifier).trim().slice(0, 120) },
      }).catch(() => {});
      res.setHeader('Retry-After', String(Math.max(1, retryMinutes) * 60));
      return res.status(429).json({
        error: `Too many failed attempts. Account locked. Try again in ${Math.max(1, retryMinutes)} minute(s).`,
      });
    }

    const user = await findUserForLogin(db, rawIdentifier);
    const validPassword = await verifyPasswordWithDummyFallback(password, user?.password_hash);

    if (!user || !validPassword) {
      const justLocked = recordFailure(rawIdentifier);
      await logFiscalEventFromReq(req, {
        tableName: 'users',
        action: justLocked ? 'login_locked' : 'login_failed',
        userName: String(rawIdentifier).trim().slice(0, 120) || 'unknown',
        description: justLocked ? 'Account locked after repeated failed logins' : 'Failed login attempt',
        newValues: { identifier: String(rawIdentifier).trim().slice(0, 120) },
      }).catch(() => {});
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    recordSuccess(rawIdentifier);
    await upgradePasswordHashIfLegacy(db, user.id, password, user.password_hash);

    let effectiveBranchId = user.branch_id;
    try {
      effectiveBranchId = await resolveAndPersistUserBranchId(user);
    } catch (branchErr) {
      console.warn('[AUTH] branch assignment fix skipped:', branchErr?.message || branchErr);
    }
    const { token, jti } = issueToken(user);

    await startSession(req, {
      userId: user.id,
      userName: user.name,
      branchId: effectiveBranchId,
      tokenJti: jti,
    });

    await logFiscalEventFromReq(req, {
      tableName: 'users',
      recordId: user.id,
      action: 'login',
      userId: user.id,
      userName: user.name,
      branchId: effectiveBranchId,
      description: `Login: ${user.name || user.email}`,
      newValues: { sessionJti: jti },
    });

    res.json({
      token,
      user: {
        ...mapUserRow(user),
        branchId: effectiveBranchId ?? mapUserRow(user).branchId,
      },
    });
  } catch (error) {
    console.error('[AUTH ERROR]', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// End session — requires JWT
router.post('/logout', requireAuth, async (req, res) => {
  try {
    await endSession({ tokenJti: req.tokenJti, userId: req.user.id, reason: 'logout' });
    await logFiscalEventFromReq(req, {
      tableName: 'users',
      recordId: req.user.id,
      action: 'logout',
      userId: req.user.id,
      userName: req.user.name,
      branchId: req.user.branchId,
      description: `Logout: ${req.user.name || req.user.email}`,
    });
    res.json({ success: true });
  } catch (error) {
    console.error('[AUTH ERROR] logout:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Current session — requires JWT
router.get('/me', requireAuth, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, email, name, role, branch_id, is_active, created_at FROM users WHERE id = $1',
      [req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'User not found' });
    }
    const row = result.rows[0];
    const effectiveBranchId = await resolveAndPersistUserBranchId(row);
    res.json({
      ...mapUserRow(row),
      branchId: effectiveBranchId ?? mapUserRow(row).branchId,
    });
  } catch (error) {
    console.error('[AUTH ERROR] me:', error);
    res.status(500).json({ error: 'Failed to load user' });
  }
});

// User management — admin only
router.get('/users', requireAdmin, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, email, username, name, role, branch_id, is_active, created_at, updated_at
       FROM users
       ORDER BY name`,
    );
    res.json(result.rows.map(mapUserRow));
  } catch (error) {
    console.error('[AUTH ERROR] list users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

router.post('/users', requireAdmin, async (req, res) => {
  try {
    const { email, name, role, branchId, password, username } = req.body;
    if (!email || !name || !role) {
      return res.status(400).json({ error: 'Email, name and role are required' });
    }

    const { email: normalizedEmail, username: normalizedUsername } = normalizeUserIdentity(email, username);
    const plainPassword = password != null && String(password).length > 0 ? String(password) : null;
    if (!plainPassword || plainPassword.length < 8) {
      return res.status(400).json({ error: 'Password is required (minimum 8 characters)' });
    }

    const existing = await db.query('SELECT id FROM users WHERE LOWER(email) = $1', [normalizedEmail]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    try {
      const dupUser = await db.query('SELECT id FROM users WHERE LOWER(username) = $1', [normalizedUsername]);
      if (dupUser.rows.length > 0) {
        return res.status(409).json({ error: 'Username already in use' });
      }
    } catch (_) {
      /* username column may be missing on very old DBs */
    }

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(plainPassword);

    await db.query(
      `INSERT INTO users (id, email, username, name, role, branch_id, password_hash, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, normalizedEmail, normalizedUsername, name, role, branchId || null, passwordHash],
    );

    const created = await db.query(
      'SELECT id, email, username, name, role, branch_id, is_active, created_at, updated_at FROM users WHERE id = $1',
      [id],
    );
    await logFiscalEventFromReq(req, {
      tableName: 'users',
      recordId: id,
      action: 'create',
      userId: req.user?.id,
      userName: req.user?.name,
      description: `User created: ${name}`,
      newValues: { email: normalizedEmail, role, branchId: branchId || null },
    }).catch(() => {});
    res.status(201).json(mapUserRow(created.rows[0]));
  } catch (error) {
    console.error('[AUTH ERROR] create user:', error);
    res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { email, name, role, branchId, isActive, password, username } = req.body;

    const existingRes = await db.query(
      'SELECT id, email, username, name, role, branch_id, is_active FROM users WHERE id = $1',
      [id],
    );
    if (existingRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const before = existingRes.rows[0];

    let normalizedEmail = null;
    let normalizedUsername = null;
    if (email != null || username != null) {
      const identity = normalizeUserIdentity(
        email != null ? email : '',
        username != null ? username : '',
      );
      normalizedEmail = email != null ? identity.email : null;
      normalizedUsername = username != null || email != null ? identity.username : null;
    }

    if (normalizedEmail) {
      const dup = await db.query('SELECT id FROM users WHERE LOWER(email) = $1 AND id != $2', [
        normalizedEmail,
        id,
      ]);
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }

    if (normalizedUsername) {
      try {
        const dupUser = await db.query('SELECT id FROM users WHERE LOWER(username) = $1 AND id != $2', [
          normalizedUsername,
          id,
        ]);
        if (dupUser.rows.length > 0) {
          return res.status(409).json({ error: 'Username already in use' });
        }
      } catch (_) {}
    }

    let passwordHash;
    if (password != null && String(password).length > 0) {
      if (String(password).length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }
      passwordHash = await hashPassword(String(password));
    }

    await db.query(
      `UPDATE users SET
         email = COALESCE($2, email),
         username = COALESCE($3, username),
         name = COALESCE($4, name),
         role = COALESCE($5, role),
         branch_id = COALESCE($6, branch_id),
         is_active = COALESCE($7, is_active),
         password_hash = COALESCE($8, password_hash),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        id,
        normalizedEmail,
        normalizedUsername,
        name || null,
        role || null,
        branchId !== undefined ? branchId : null,
        isActive !== undefined ? isActive : null,
        passwordHash || null,
      ],
    );

    const updated = await db.query(
      'SELECT id, email, username, name, role, branch_id, is_active, created_at, updated_at FROM users WHERE id = $1',
      [id],
    );
    const after = updated.rows[0];
    await logFiscalEventFromReq(req, {
      tableName: 'users',
      recordId: id,
      action: passwordHash ? 'password_reset' : 'update',
      userId: req.user?.id,
      userName: req.user?.name,
      description: passwordHash
        ? `Password reset for ${after.name || after.email}`
        : `User updated: ${after.name || after.email}`,
      oldValues: {
        role: before.role,
        isActive: before.is_active,
        branchId: before.branch_id,
      },
      newValues: {
        role: after.role,
        isActive: after.is_active,
        branchId: after.branch_id,
        email: after.email,
      },
    }).catch(() => {});
    res.json(mapUserRow(after));
  } catch (error) {
    console.error('[AUTH ERROR] update user:', error);
    res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

/**
 * Verify an elevated (admin/manager) password to authorize a sensitive POS action
 * such as applying a discount. Does NOT issue a token or start a session — it only
 * confirms a supervisor approved the action, and records it in the fiscal audit log.
 */
router.post('/verify-elevated', requireAuth, async (req, res) => {
  try {
    const password = req.body?.password;
    const identifier = req.body?.identifier;
    const reason = String(req.body?.reason || 'Ação privilegiada').slice(0, 200);
    if (password == null || String(password).length === 0) {
      return res.status(400).json({ error: 'Password is required' });
    }

    let approver = null;
    if (identifier && String(identifier).trim()) {
      const user = await findUserForLogin(db, String(identifier).trim());
      if (user && ['admin', 'manager'].includes(String(user.role))
        && (user.is_active === true || user.is_active === 1)) {
        const ok = await verifyPassword(String(password), user.password_hash);
        if (ok) approver = user;
      }
    } else {
      const candidates = await db.query(
        `SELECT id, name, role, password_hash FROM users
         WHERE role IN ('admin', 'manager') AND is_active = true`,
      );
      for (const candidate of candidates.rows) {
        // eslint-disable-next-line no-await-in-loop
        if (await verifyPassword(String(password), candidate.password_hash)) {
          approver = candidate;
          break;
        }
      }
    }

    if (!approver) {
      await logFiscalEventFromReq(req, {
        tableName: 'users',
        action: 'authorize_failed',
        userId: req.user?.id,
        userName: req.user?.name,
        description: `Autorização recusada: ${reason}`,
      }).catch(() => {});
      return res.status(401).json({ error: 'Invalid supervisor credentials' });
    }

    await logFiscalEventFromReq(req, {
      tableName: 'users',
      recordId: approver.id,
      action: 'authorize',
      userId: req.user?.id,
      userName: req.user?.name,
      description: `${reason} — autorizado por ${approver.name} (${approver.role})`,
      newValues: { approverId: approver.id, approverName: approver.name, approverRole: approver.role },
    }).catch(() => {});

    res.json({ ok: true, approver: { id: approver.id, name: approver.name, role: approver.role } });
  } catch (error) {
    console.error('[AUTH ERROR] verify-elevated:', error);
    res.status(500).json({ error: error.message || 'Authorization failed' });
  }
});

/** Logged-in user changes own password (requires current password). */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const currentPassword = req.body?.currentPassword;
    const newPassword = req.body?.newPassword;
    if (currentPassword == null || String(currentPassword).length === 0) {
      return res.status(400).json({ error: 'Current password is required' });
    }
    if (newPassword == null || String(newPassword).length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const row = await db.query('SELECT id, password_hash FROM users WHERE id = $1', [req.user.id]);
    if (row.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const storedHash = row.rows[0].password_hash;
    const valid = await verifyPassword(String(currentPassword), storedHash);
    if (!valid) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const passwordHash = await hashPassword(String(newPassword));
    await db.query(
      'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [passwordHash, req.user.id],
    );

    await logFiscalEventFromReq(req, {
      tableName: 'users',
      recordId: req.user.id,
      action: 'password_change',
      userId: req.user.id,
      userName: req.user.name,
      description: 'User changed own password',
    }).catch(() => {});

    res.json({ success: true });
  } catch (error) {
    console.error('[AUTH ERROR] change-password:', error);
    res.status(500).json({ error: error.message || 'Failed to change password' });
  }
});

router.delete('/users/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `UPDATE users SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    await endSession({ userId: id, reason: 'deactivated' });
    await logFiscalEventFromReq(req, {
      tableName: 'users',
      recordId: id,
      action: 'status_change',
      userId: req.user?.id,
      userName: req.user?.name,
      description: `User deactivated: ${id}`,
      newValues: { isActive: false },
    }).catch(() => {});
    res.json({ success: true });
  } catch (error) {
    console.error('[AUTH ERROR] delete user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

module.exports = router;
